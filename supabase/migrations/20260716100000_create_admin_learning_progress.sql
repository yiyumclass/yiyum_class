create or replace function public.get_admin_learning_progress()
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
  last_lesson_title text
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
      and lesson.video_path is not null
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
    -- 한 상품에 여러 강의를 연결하는 1:N으로 확장하면 수강권 하나가 여러 course 행으로
    -- 펼쳐지므로, distinct on (entitlement_id)을 (entitlement_id, course_id)로 바꾸고
    -- 위 조인·집계도 course 단위로 함께 조정해야 한다.
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
  )
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
    coalesce(aggregate.progress_percent, 0),
    aggregate.last_watched_at,
    latest.last_lesson_key,
    latest.last_lesson_title
  from aggregated_progress as aggregate
  left join latest_lessons as latest
    on latest.entitlement_id = aggregate.entitlement_id
  order by aggregate.last_watched_at desc nulls last, aggregate.member_name;
$$;

comment on function public.get_admin_learning_progress() is
  '활성 관리자가 유효한 강의 수강권별 공개 차시 진도와 최근 학습을 조회한다.';

revoke all on function public.get_admin_learning_progress() from public;
grant execute on function public.get_admin_learning_progress() to authenticated;
