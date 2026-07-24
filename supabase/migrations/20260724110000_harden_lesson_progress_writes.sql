-- Route all lesson progress writes through a validating RPC. Users may still
-- read their own progress, but cannot directly forge refund evidence columns
-- through PostgREST table writes.

revoke insert, update on table public.lesson_progress from authenticated;

drop policy if exists "Users can create their own lesson progress"
  on public.lesson_progress;
drop policy if exists "Users can update their own lesson progress"
  on public.lesson_progress;

create or replace function public.save_my_lesson_progress(
  target_course_slug text,
  target_lesson_id text,
  target_position_seconds integer,
  target_duration_seconds integer,
  target_completion_action text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_product_id uuid;
  stored_duration_seconds integer;
  normalized_duration_seconds integer;
  normalized_position_seconds integer;
  saved_at timestamptz := now();
  next_completed_at timestamptz;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if target_completion_action not in ('preserve', 'complete', 'incomplete') then
    raise exception 'invalid completion action' using errcode = '22023';
  end if;

  if target_course_slug is null
    or target_lesson_id is null
    or target_position_seconds is null
    or target_duration_seconds is null
    or target_position_seconds < 0
    or target_duration_seconds < 0 then
    raise exception 'invalid lesson progress' using errcode = '22023';
  end if;

  select product.id, lesson.duration_seconds
    into target_product_id, stored_duration_seconds
  from public.lessons as lesson
  join public.course_sections as section on section.id = lesson.section_id
  join public.courses as course on course.id = section.course_id
  join public.products as product on product.id = course.product_id
  where course.slug = target_course_slug
    and lesson.lesson_key = target_lesson_id
    and (
      public.is_admin()
      or (
        product.status <> 'archived'
        and course.status = 'published'
        and section.status = 'published'
        and lesson.status = 'published'
      )
    );

  if not found then
    raise exception 'lesson not found' using errcode = 'P0002';
  end if;

  if not public.is_admin()
    and not exists (
      select 1
      from public.product_entitlements as entitlement
      where entitlement.user_id = actor_id
        and entitlement.product_id = target_product_id
        and entitlement.status = 'active'
        and (entitlement.expires_at is null or entitlement.expires_at > saved_at)
    ) then
    raise exception 'active entitlement required' using errcode = '42501';
  end if;

  normalized_duration_seconds := greatest(
    0,
    least(target_duration_seconds, stored_duration_seconds + 5)
  );
  normalized_position_seconds := greatest(
    0,
    least(target_position_seconds, normalized_duration_seconds)
  );

  if target_completion_action = 'complete' then
    next_completed_at := saved_at;
  end if;

  insert into public.lesson_progress (
    user_id,
    course_slug,
    lesson_id,
    last_position_seconds,
    duration_seconds,
    completed_at,
    last_watched_at,
    updated_at
  )
  values (
    actor_id,
    target_course_slug,
    target_lesson_id,
    normalized_position_seconds,
    normalized_duration_seconds,
    next_completed_at,
    saved_at,
    saved_at
  )
  on conflict (user_id, course_slug, lesson_id) do update
  set
    last_position_seconds = excluded.last_position_seconds,
    duration_seconds = excluded.duration_seconds,
    completed_at = case
      when target_completion_action = 'complete' then saved_at
      when target_completion_action = 'incomplete' then null
      else public.lesson_progress.completed_at
    end,
    last_watched_at = saved_at,
    updated_at = saved_at;

  return saved_at;
end;
$$;

comment on function public.save_my_lesson_progress(text, text, integer, integer, text) is
  '로그인 사용자의 학습 진도를 이용권·공개 차시·영상 길이 검증 후 저장한다. 환불 증거 컬럼은 DB 트리거와 서버 시간이 보존한다.';

revoke all on function public.save_my_lesson_progress(text, text, integer, integer, text)
  from public, anon;
grant execute on function public.save_my_lesson_progress(text, text, integer, integer, text)
  to authenticated;
