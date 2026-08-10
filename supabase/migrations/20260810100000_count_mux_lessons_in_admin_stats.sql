-- Mux 로 옮긴 차시가 관리자 통계에서 통째로 빠지던 것을 바로잡는다.
--
-- 진도 집계와 주문별 시청 통계는 "영상이 붙은 차시"를 video_path 로만 판정했다.
-- Mux 업로드는 파일을 Mux 에 두고 mux_playback_id 만 저장하므로 video_path 가
-- 비어 있고, 그래서 Mux 차시는 전체 차시 수에 잡히지 않았다. 분모가 0이 되어
-- 진도율이 0%로 보이고, 환불 판단 근거인 시청량도 0으로 보였다.
--
-- 강의실 재생(get_course_video_manifest)은 20260805100000 에서 이미 "둘 중 하나만
-- 있으면 재생 대상"으로 고쳤다. 관리자 통계도 같은 기준으로 맞춘다.
--
-- 판정식은 재생 쪽과 동일하게 mux_status = 'ready' 까지 확인한다. 변환 중인 영상은
-- 아직 볼 수 없으므로 차시 수에 넣으면 진도율이 낮게 나온다.


-- 주문별 시청 통계 ---------------------------------------------------

create or replace function public.admin_order_learning_stats(
  p_user_id uuid,
  p_course_id uuid,
  p_course_slug text
)
returns table (
  total_lessons bigint,
  started_lessons bigint,
  completed_lessons bigint,
  watched_seconds bigint,
  progress_percent numeric,
  first_watched_at timestamptz,
  last_watched_at timestamptz
)
language sql
stable
parallel safe
set search_path = ''
as $$
  select
    count(lesson.lesson_key)::bigint,
    count(progress.lesson_id) filter (
      where progress.max_position_seconds > 0
        or progress.first_completed_at is not null
    )::bigint,
    count(progress.lesson_id) filter (
      where progress.first_completed_at is not null
    )::bigint,
    coalesce(sum(progress.max_position_seconds), 0)::bigint,
    case
      when count(lesson.lesson_key) = 0 then 0::numeric
      else round(
        (
          coalesce(sum(
            case
              when progress.first_completed_at is not null then 1::numeric
              when progress.lesson_id is null then 0::numeric
              else least(
                0.99::numeric,
                greatest(
                  0::numeric,
                  progress.max_position_seconds::numeric /
                    nullif(coalesce(nullif(progress.duration_seconds, 0), lesson.duration_seconds), 0)
                )
              )
            end
          ), 0) / count(lesson.lesson_key)::numeric
        ) * 100,
        1
      )
    end,
    min(progress.first_watched_at),
    max(progress.last_watched_at)
  from public.course_sections as section
  join public.lessons as lesson
    on lesson.section_id = section.id
   and lesson.status = 'published'
   and (
        lesson.video_path is not null
        or (lesson.mux_playback_id is not null and lesson.mux_status = 'ready')
      )
  left join public.lesson_progress as progress
    on progress.user_id = p_user_id
   and progress.course_slug = p_course_slug
   and progress.lesson_id = lesson.lesson_key
  where section.course_id = p_course_id
    and section.status = 'published';
$$;


-- 관리자 진도 목록 ---------------------------------------------------

create or replace function public.admin_learning_progress_base(
  p_search text default null,
  p_status text default 'all',
  p_course_id uuid default null
)
returns table (
  member_id uuid,
  member_email text,
  member_name text,
  entitlement_id uuid,
  course_id uuid,
  course_slug text,
  course_title text,
  total_lessons bigint,
  started_lessons bigint,
  completed_lessons bigint,
  watched_seconds bigint,
  progress_percent numeric,
  last_watched_at timestamptz,
  last_lesson_key text,
  last_lesson_title text,
  learning_state text,
  needs_attention boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with eligible_enrollments as (
    select
      entitlement.id as entitlement_id,
      account.id as member_id,
      coalesce(account.email, '이메일 정보 없음') as member_email,
      coalesce(
        nullif(account.raw_user_meta_data ->> 'nickname', ''),
        nullif(account.raw_user_meta_data ->> 'name', ''),
        nullif(split_part(coalesce(account.email, ''), '@', 1), ''),
        '이름 미등록'
      ) as member_name,
      course.id as course_id,
      course.slug as course_slug,
      course.title as course_title
    from public.product_entitlements as entitlement
    join auth.users as account on account.id = entitlement.user_id
    join public.courses as course on course.product_id = entitlement.product_id
    where public.is_admin()
      and account.deleted_at is null
      and entitlement.status = 'active'
      and (entitlement.expires_at is null or entitlement.expires_at > now())
      and course.status = 'published'
      and (p_course_id is null or course.id = p_course_id)
  ),
  available_lessons as (
    select
      course.id as course_id,
      course.slug as course_slug,
      lesson.lesson_key,
      lesson.title,
      lesson.duration_seconds
    from public.courses as course
    join public.course_sections as section on section.course_id = course.id
    join public.lessons as lesson on lesson.section_id = section.id
    where course.status = 'published'
      and section.status = 'published'
      and lesson.status = 'published'
      and (
        lesson.video_path is not null
        or (lesson.mux_playback_id is not null and lesson.mux_status = 'ready')
      )
  ),
  aggregated_progress as (
    select
      enrollment.entitlement_id,
      enrollment.member_id,
      enrollment.member_email,
      enrollment.member_name,
      enrollment.course_id,
      enrollment.course_slug,
      enrollment.course_title,
      count(lesson.lesson_key)::bigint as total_lessons,
      count(progress.lesson_id) filter (
        where progress.last_position_seconds > 0
          or progress.completed_at is not null
      )::bigint as started_lessons,
      count(progress.lesson_id) filter (
        where progress.completed_at is not null
      )::bigint as completed_lessons,
      coalesce(sum(progress.last_position_seconds), 0)::bigint as watched_seconds,
      case
        when count(lesson.lesson_key) = 0 then 0::numeric
        else round(
          (
            sum(
              case
                when progress.completed_at is not null then 1::numeric
                when progress.lesson_id is null then 0::numeric
                else least(
                  0.99::numeric,
                  greatest(
                    0::numeric,
                    progress.last_position_seconds::numeric /
                      nullif(
                        coalesce(
                          nullif(progress.duration_seconds, 0),
                          nullif(lesson.duration_seconds, 0)
                        ),
                        0
                      )
                  )
                )
              end
            ) / count(lesson.lesson_key)::numeric
          ) * 100,
          1
        )
      end as progress_percent,
      max(progress.last_watched_at) as last_watched_at
    from eligible_enrollments as enrollment
    left join available_lessons as lesson
      on lesson.course_id = enrollment.course_id
    left join public.lesson_progress as progress
      on progress.user_id = enrollment.member_id
     and progress.course_slug = enrollment.course_slug
     and progress.lesson_id = lesson.lesson_key
    group by
      enrollment.entitlement_id,
      enrollment.member_id,
      enrollment.member_email,
      enrollment.member_name,
      enrollment.course_id,
      enrollment.course_slug,
      enrollment.course_title
  ),
  latest_lessons as (
    -- products:courses = 1:1 (courses.product_id UNIQUE) 가정에 의존한다.
    select distinct on (enrollment.entitlement_id)
      enrollment.entitlement_id,
      progress.lesson_id as last_lesson_key,
      lesson.title as last_lesson_title
    from eligible_enrollments as enrollment
    join public.lesson_progress as progress
      on progress.user_id = enrollment.member_id
     and progress.course_slug = enrollment.course_slug
    join available_lessons as lesson
      on lesson.course_id = enrollment.course_id
     and lesson.lesson_key = progress.lesson_id
    order by enrollment.entitlement_id, progress.last_watched_at desc
  ),
  labeled as (
    select
      aggregate.member_id,
      aggregate.member_email,
      aggregate.member_name,
      aggregate.entitlement_id,
      aggregate.course_id,
      aggregate.course_slug,
      aggregate.course_title,
      aggregate.total_lessons,
      aggregate.started_lessons,
      aggregate.completed_lessons,
      aggregate.watched_seconds,
      coalesce(aggregate.progress_percent, 0) as progress_percent,
      aggregate.last_watched_at,
      latest.last_lesson_key,
      latest.last_lesson_title,
      -- 화면(getLearningState)과 같은 판정이다. 필터를 SQL로 내리려면 여기 있어야 한다.
      case
        when aggregate.total_lessons > 0
          and aggregate.completed_lessons >= aggregate.total_lessons then 'completed'
        when aggregate.last_watched_at is null
          and aggregate.started_lessons = 0 then 'not_started'
        else 'in_progress'
      end as learning_state
    from aggregated_progress as aggregate
    left join latest_lessons as latest
      on latest.entitlement_id = aggregate.entitlement_id
  ),
  scored as (
    select
      labeled.*,
      -- 완료가 아니면서 아직 안 봤거나 마지막 학습이 14일을 넘긴 경우
      case
        when labeled.learning_state = 'completed' then false
        when labeled.last_watched_at is null then true
        else labeled.last_watched_at < now() - interval '14 days'
      end as needs_attention
    from labeled
  )
  select * from scored
  where (
      p_search is null or btrim(p_search) = ''
      or scored.member_name ilike '%' || btrim(p_search) || '%'
      or scored.member_email ilike '%' || btrim(p_search) || '%'
      or scored.course_title ilike '%' || btrim(p_search) || '%'
    )
    and (
      p_status is null or p_status = 'all'
      or (p_status = 'attention' and scored.needs_attention)
      or (p_status <> 'attention' and scored.learning_state = p_status)
    );
$$;

-- 권한 --------------------------------------------------------------------
-- create or replace 는 기존 권한을 유지하지만, 이 파일만 읽고도 접근 범위를
-- 알 수 있도록 원본과 같은 구문을 다시 적어 둔다.

revoke all on function public.admin_order_learning_stats(uuid, uuid, text) from anon;
revoke all on function public.admin_learning_progress_base(text, text, uuid) from anon;
