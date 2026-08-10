-- 수강 기록이 있는 차시도 지울 수 있게 한다. 대신 기록을 볼 수 있게 남긴다.
--
-- 20260806100000 은 수강 기록이 있는 차시를 아예 못 지우게 막았다. 환불 분쟁에서
-- "얼마나 봤는가"를 증명할 근거를 잃지 않으려는 조치였다. 그런데 커리큘럼을 개편해
-- 차시를 실제로 걷어내야 하는 경우가 생기면 보관 처리밖에 길이 없고, 관리자 목록에는
-- 계속 남는다.
--
-- 여기서 중요한 사실이 하나 있다. lesson_progress 는 차시를 외래키가 아니라
-- (course_slug, lesson_id) 문자열로 참조한다. 그래서 차시를 지워도 수강 기록 행 자체는
-- 지워지지 않고 그대로 남는다. 잃는 것은 기록이 아니라 "그게 어느 차시였는가" 하는
-- 맥락이다. 진도 화면이 lessons 표를 기준으로 만들어지기 때문에, 차시가 사라지면
-- 붙을 자리가 없어져 화면에서만 보이지 않게 된다.
--
-- 그래서 지울 때 차시 정보를 스냅샷으로 떠 두고, 그 스냅샷을 기준으로 남은 수강 기록을
-- 다시 볼 수 있게 한다. 기록을 남긴다고 말하려면 볼 방법이 함께 있어야 한다.
--
-- 권한은 owner 로 좁힌다. 수강생이 본 차시를 지우는 일은 되돌릴 수 없다.

-- 삭제된 차시 스냅샷 --------------------------------------------------------

create table if not exists public.deleted_lessons (
  id uuid primary key default gen_random_uuid(),
  -- 강의가 나중에 지워질 수도 있으므로 외래키로 묶지 않는다. 스냅샷은 스스로
  -- 완결되어야 한다.
  course_id uuid,
  course_slug text not null,
  course_title text not null,
  section_title text,
  lesson_key text not null,
  lesson_title text not null,
  duration_seconds integer not null default 0,
  had_video boolean not null default false,
  -- 삭제 시점의 시청자 수. 이후 기록이 늘거나 줄어도 그때의 규모를 알 수 있게 둔다.
  watcher_count integer not null default 0,
  deleted_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz not null default now()
);

comment on table public.deleted_lessons is
  '삭제된 차시의 스냅샷. 남아 있는 lesson_progress 를 다시 읽기 위한 열쇠다.';

-- 같은 lesson_key 가 다시 만들어졌다가 또 지워질 수 있으므로 유일 제약을 걸지 않는다.
create index if not exists deleted_lessons_lookup_idx
  on public.deleted_lessons (course_slug, lesson_key);
create index if not exists deleted_lessons_deleted_at_idx
  on public.deleted_lessons (deleted_at desc);

alter table public.deleted_lessons enable row level security;

drop policy if exists "관리자만 삭제된 차시를 읽는다" on public.deleted_lessons;
create policy "관리자만 삭제된 차시를 읽는다"
  on public.deleted_lessons
  for select
  using (public.is_admin());

-- 쓰기 정책은 두지 않는다. 아래 security definer 함수로만 기록이 쌓인다.

-- 삭제 전 영향 확인 ---------------------------------------------------------

-- 지우기 전에 몇 명의 기록이 걸려 있는지 보여 주려고 쓴다. 숫자를 모르고 누르는
-- 삭제와 알고 누르는 삭제는 다르다.
create or replace function public.lesson_deletion_impact(target_lesson_id uuid)
returns table (
  lesson_title text,
  course_slug text,
  has_video boolean,
  watcher_count integer,
  completed_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select
      lesson.title as lesson_title,
      course.slug as course_slug,
      lesson.lesson_key,
      (lesson.video_path is not null or lesson.mux_playback_id is not null) as has_video
    from public.lessons as lesson
    join public.course_sections as section on section.id = lesson.section_id
    join public.courses as course on course.id = section.course_id
    where lesson.id = target_lesson_id
      and public.is_admin()
  )
  select
    target.lesson_title,
    target.course_slug,
    target.has_video,
    (
      select count(*)::integer
      from public.lesson_progress as progress
      where progress.course_slug = target.course_slug
        and progress.lesson_id = target.lesson_key
    ),
    (
      select count(*)::integer
      from public.lesson_progress as progress
      where progress.course_slug = target.course_slug
        and progress.lesson_id = target.lesson_key
        and progress.first_completed_at is not null
    )
  from target;
$$;

comment on function public.lesson_deletion_impact(uuid) is
  '차시를 지우기 전에 걸려 있는 수강 기록 규모를 알려준다.';

-- 강제 삭제 -----------------------------------------------------------------

create or replace function public.force_delete_lesson(target_lesson_id uuid)
returns table (
  deleted boolean,
  reason text,
  mux_asset_ids text[],
  watcher_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
  v_course_slug text;
  v_course_title text;
  v_section_title text;
  v_lesson_key text;
  v_lesson_title text;
  v_duration integer;
  v_asset_id text;
  v_has_video boolean;
  v_watchers integer;
begin
  -- 되돌릴 수 없는 삭제라 operator 에게는 열지 않는다.
  if not public.is_admin(array['owner']::text[]) then
    raise exception 'owner permission required' using errcode = '42501';
  end if;

  select
    course.id,
    course.slug,
    course.title,
    section.title,
    lesson.lesson_key,
    lesson.title,
    lesson.duration_seconds,
    lesson.mux_asset_id,
    (lesson.video_path is not null or lesson.mux_playback_id is not null)
  into
    v_course_id,
    v_course_slug,
    v_course_title,
    v_section_title,
    v_lesson_key,
    v_lesson_title,
    v_duration,
    v_asset_id,
    v_has_video
  from public.lessons as lesson
  join public.course_sections as section on section.id = lesson.section_id
  join public.courses as course on course.id = section.course_id
  where lesson.id = target_lesson_id;

  if v_course_slug is null then
    return query select false, 'not_found'::text, array[]::text[], 0;
    return;
  end if;

  select count(*)::integer into v_watchers
  from public.lesson_progress as progress
  where progress.course_slug = v_course_slug
    and progress.lesson_id = v_lesson_key;

  -- 스냅샷을 먼저 남긴다. 삭제가 실패하면 같은 트랜잭션에서 함께 되돌아간다.
  insert into public.deleted_lessons (
    course_id,
    course_slug,
    course_title,
    section_title,
    lesson_key,
    lesson_title,
    duration_seconds,
    had_video,
    watcher_count,
    deleted_by
  )
  values (
    v_course_id,
    v_course_slug,
    v_course_title,
    v_section_title,
    v_lesson_key,
    v_lesson_title,
    coalesce(v_duration, 0),
    coalesce(v_has_video, false),
    v_watchers,
    (select auth.uid())
  );

  insert into public.admin_audit_logs (actor_user_id, action, target_type, target_id, metadata)
  values (
    (select auth.uid()),
    'lessons.force_deleted',
    'lessons',
    target_lesson_id::text,
    jsonb_build_object(
      'course_slug', v_course_slug,
      'lesson_key', v_lesson_key,
      'lesson_title', v_lesson_title,
      'watcher_count', v_watchers
    )
  );

  -- lesson_progress 는 건드리지 않는다. 외래키가 아니라 문자열 참조라 그대로 남고,
  -- 그것이 환불 분쟁에서 쓸 근거다.
  delete from public.lessons where id = target_lesson_id;

  return query
    select
      true,
      'ok'::text,
      case when v_asset_id is null then array[]::text[] else array[v_asset_id] end,
      v_watchers;
end;
$$;

comment on function public.force_delete_lesson(uuid) is
  '수강 기록이 있어도 차시를 지운다. 스냅샷을 남겨 기록을 계속 읽을 수 있게 한다.';

-- 삭제된 차시 기록 조회 -----------------------------------------------------

-- 스냅샷과 남아 있는 lesson_progress 를 이어 붙인다. 시청 수치는 삭제 시점이 아니라
-- 지금 값을 읽는다. 기록은 삭제 뒤에도 갱신될 수 있기 때문이다.
create or replace function public.get_deleted_lesson_records(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  course_slug text,
  course_title text,
  section_title text,
  lesson_key text,
  lesson_title text,
  duration_seconds integer,
  had_video boolean,
  watcher_count_at_deletion integer,
  record_count integer,
  completed_count integer,
  watched_seconds bigint,
  last_watched_at timestamptz,
  deleted_at timestamptz,
  deleted_by_email text,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with filtered as (
    select record.*
    from public.deleted_lessons as record
    where public.is_admin()
      and (
        p_search is null
        or record.lesson_title ilike '%' || p_search || '%'
        or record.course_title ilike '%' || p_search || '%'
        or record.course_slug ilike '%' || p_search || '%'
      )
  ),
  counted as (
    select count(*)::bigint as total from filtered
  )
  select
    filtered.id,
    filtered.course_slug,
    filtered.course_title,
    filtered.section_title,
    filtered.lesson_key,
    filtered.lesson_title,
    filtered.duration_seconds,
    filtered.had_video,
    filtered.watcher_count as watcher_count_at_deletion,
    coalesce(stats.record_count, 0)::integer,
    coalesce(stats.completed_count, 0)::integer,
    coalesce(stats.watched_seconds, 0)::bigint,
    stats.last_watched_at,
    filtered.deleted_at,
    coalesce(actor.email, '알 수 없음'),
    counted.total
  from filtered
  cross join counted
  left join lateral (
    select
      count(*)::integer as record_count,
      count(*) filter (where progress.first_completed_at is not null)::integer as completed_count,
      sum(progress.max_position_seconds)::bigint as watched_seconds,
      max(progress.last_watched_at) as last_watched_at
    from public.lesson_progress as progress
    where progress.course_slug = filtered.course_slug
      and progress.lesson_id = filtered.lesson_key
  ) as stats on true
  left join auth.users as actor on actor.id = filtered.deleted_by
  order by filtered.deleted_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

comment on function public.get_deleted_lesson_records(text, integer, integer) is
  '삭제된 차시와, 그 차시에 남아 있는 수강 기록 집계를 함께 돌려준다.';

-- 삭제된 차시의 회원별 기록 -------------------------------------------------

create or replace function public.get_deleted_lesson_watchers(p_record_id uuid)
returns table (
  member_id uuid,
  member_email text,
  member_name text,
  max_position_seconds integer,
  duration_seconds integer,
  first_completed_at timestamptz,
  first_watched_at timestamptz,
  last_watched_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    account.id,
    coalesce(account.email, '이메일 정보 없음'),
    coalesce(
      nullif(account.raw_user_meta_data ->> 'nickname', ''),
      nullif(account.raw_user_meta_data ->> 'name', ''),
      nullif(split_part(coalesce(account.email, ''), '@', 1), ''),
      '이름 미등록'
    ),
    progress.max_position_seconds,
    progress.duration_seconds,
    progress.first_completed_at,
    progress.first_watched_at,
    progress.last_watched_at
  from public.deleted_lessons as record
  join public.lesson_progress as progress
    on progress.course_slug = record.course_slug
   and progress.lesson_id = record.lesson_key
  join auth.users as account on account.id = progress.user_id
  where record.id = p_record_id
    and public.is_admin()
  order by progress.last_watched_at desc;
$$;

comment on function public.get_deleted_lesson_watchers(uuid) is
  '삭제된 차시를 누가 얼마나 봤는지 회원별로 돌려준다.';

-- 권한 ----------------------------------------------------------------------

revoke all on function public.lesson_deletion_impact(uuid) from anon;
revoke all on function public.force_delete_lesson(uuid) from anon;
revoke all on function public.get_deleted_lesson_records(text, integer, integer) from anon;
revoke all on function public.get_deleted_lesson_watchers(uuid) from anon;

grant execute on function public.lesson_deletion_impact(uuid) to authenticated;
grant execute on function public.force_delete_lesson(uuid) to authenticated;
grant execute on function public.get_deleted_lesson_records(text, integer, integer) to authenticated;
grant execute on function public.get_deleted_lesson_watchers(uuid) to authenticated;
