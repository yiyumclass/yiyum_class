-- 강의 콘텐츠 삭제는 지금까지 막혀 있었다. lesson_progress 가 차시를 외래키가 아니라
-- (course_slug, lesson_id) 문자열로 참조해서, 차시를 지우면 수강 기록이 고아로 남기
-- 때문이다. 그 기록은 환불 분쟁에서 "얼마나 봤는가"를 증명하는 근거라 날리면 안 된다.
--
-- 다만 전면 금지는 과했다. 아무도 보지 않은 차시는 지워도 깨질 것이 없는데 테스트로
-- 만든 콘텐츠가 목록에 계속 쌓인다. 영상까지 붙어 있으면 Mux 무료 한도(10개)도 잡아먹는다.
--
-- 그래서 수강 기록이 있는지 확인해 안전한 것만 실제로 지운다. 판정은 앱이 아니라
-- 여기서 한다. 앱 가드는 우회할 수 있어도 이 함수는 못 지나간다.
--
-- 삭제된 차시의 Mux asset id 를 함께 돌려준다. 호출부가 Mux 쪽 자산도 정리해야
-- 무료 한도를 되찾을 수 있다.

-- 차시 삭제 --------------------------------------------------------------

create or replace function public.delete_lesson_if_unused(target_lesson_id uuid)
returns table (deleted boolean, reason text, mux_asset_ids text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_course_slug text;
  target_lesson_key text;
  target_asset_id text;
  progress_count integer;
begin
  if not public.is_admin() then
    raise exception 'admin permission required' using errcode = '42501';
  end if;

  select course.slug, lesson.lesson_key, lesson.mux_asset_id
    into target_course_slug, target_lesson_key, target_asset_id
  from public.lessons as lesson
  join public.course_sections as section on section.id = lesson.section_id
  join public.courses as course on course.id = section.course_id
  where lesson.id = target_lesson_id;

  if target_course_slug is null then
    return query select false, 'not_found'::text, array[]::text[];
    return;
  end if;

  select count(*) into progress_count
  from public.lesson_progress as progress
  where progress.course_slug = target_course_slug
    and progress.lesson_id = target_lesson_key;

  if progress_count > 0 then
    return query select false, 'has_progress'::text, array[]::text[];
    return;
  end if;

  insert into public.admin_audit_logs (actor_user_id, action, target_type, target_id, metadata)
  values (
    (select auth.uid()),
    'lessons.deleted',
    'lessons',
    target_lesson_id::text,
    jsonb_build_object('course_slug', target_course_slug, 'lesson_key', target_lesson_key)
  );

  delete from public.lessons where id = target_lesson_id;

  return query
    select true, 'ok'::text,
      case when target_asset_id is null then array[]::text[] else array[target_asset_id] end;
end;
$$;

-- 챕터 삭제 --------------------------------------------------------------

create or replace function public.delete_course_section_if_unused(target_section_id uuid)
returns table (deleted boolean, reason text, mux_asset_ids text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_course_slug text;
  section_title text;
  progress_count integer;
  asset_ids text[];
begin
  if not public.is_admin() then
    raise exception 'admin permission required' using errcode = '42501';
  end if;

  select course.slug, section.title
    into target_course_slug, section_title
  from public.course_sections as section
  join public.courses as course on course.id = section.course_id
  where section.id = target_section_id;

  if target_course_slug is null then
    return query select false, 'not_found'::text, array[]::text[];
    return;
  end if;

  -- 챕터 안의 차시 중 하나라도 수강 기록이 있으면 통째로 막는다.
  select count(*) into progress_count
  from public.lessons as lesson
  join public.lesson_progress as progress
    on progress.course_slug = target_course_slug
   and progress.lesson_id = lesson.lesson_key
  where lesson.section_id = target_section_id;

  if progress_count > 0 then
    return query select false, 'has_progress'::text, array[]::text[];
    return;
  end if;

  select coalesce(array_agg(lesson.mux_asset_id), array[]::text[]) into asset_ids
  from public.lessons as lesson
  where lesson.section_id = target_section_id
    and lesson.mux_asset_id is not null;

  insert into public.admin_audit_logs (actor_user_id, action, target_type, target_id, metadata)
  values (
    (select auth.uid()),
    'course_sections.deleted',
    'course_sections',
    target_section_id::text,
    jsonb_build_object('course_slug', target_course_slug, 'title', section_title)
  );

  delete from public.course_sections where id = target_section_id;

  return query select true, 'ok'::text, asset_ids;
end;
$$;

-- 강의 삭제 --------------------------------------------------------------
-- 강의는 챕터와 차시를 통째로 데려가므로 owner 만 지울 수 있다.

create or replace function public.delete_course_if_unused(target_course_id uuid)
returns table (deleted boolean, reason text, mux_asset_ids text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_course_slug text;
  course_title text;
  target_product_id uuid;
  progress_count integer;
  entitlement_count integer;
  asset_ids text[];
begin
  if not public.is_admin(array['owner']::text[]) then
    raise exception 'owner permission required' using errcode = '42501';
  end if;

  select course.slug, course.title, course.product_id
    into target_course_slug, course_title, target_product_id
  from public.courses as course
  where course.id = target_course_id;

  if target_course_slug is null then
    return query select false, 'not_found'::text, array[]::text[];
    return;
  end if;

  select count(*) into progress_count
  from public.lesson_progress as progress
  where progress.course_slug = target_course_slug;

  if progress_count > 0 then
    return query select false, 'has_progress'::text, array[]::text[];
    return;
  end if;

  -- 수강 기록이 없어도 이용권을 판 적이 있으면 지우면 안 된다.
  -- 아직 보지 않았을 뿐 볼 권리가 있는 사람이다.
  select count(*) into entitlement_count
  from public.product_entitlements as entitlement
  where entitlement.product_id = target_product_id
    and entitlement.status = 'active';

  if entitlement_count > 0 then
    return query select false, 'has_entitlement'::text, array[]::text[];
    return;
  end if;

  select coalesce(array_agg(lesson.mux_asset_id), array[]::text[]) into asset_ids
  from public.lessons as lesson
  join public.course_sections as section on section.id = lesson.section_id
  where section.course_id = target_course_id
    and lesson.mux_asset_id is not null;

  insert into public.admin_audit_logs (actor_user_id, action, target_type, target_id, metadata)
  values (
    (select auth.uid()),
    'courses.deleted',
    'courses',
    target_course_id::text,
    jsonb_build_object('slug', target_course_slug, 'title', course_title)
  );

  delete from public.courses where id = target_course_id;

  return query select true, 'ok'::text, asset_ids;
end;
$$;

revoke all on function public.delete_lesson_if_unused(uuid) from public, anon, authenticated;
revoke all on function public.delete_course_section_if_unused(uuid) from public, anon, authenticated;
revoke all on function public.delete_course_if_unused(uuid) from public, anon, authenticated;

grant execute on function public.delete_lesson_if_unused(uuid) to authenticated;
grant execute on function public.delete_course_section_if_unused(uuid) to authenticated;
grant execute on function public.delete_course_if_unused(uuid) to authenticated;
