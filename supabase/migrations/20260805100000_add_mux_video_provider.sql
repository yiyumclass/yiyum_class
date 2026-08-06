-- 영상 전달을 Mux로 옮기기 위한 첫 단계다.
-- 기존 Supabase Storage 경로(video_path)는 지우지 않고 그대로 둔다.
-- 차시마다 둘 중 하나만 쓰며, video_provider 가 어느 쪽인지 알려준다.

alter table public.lessons
  add column if not exists mux_upload_id text,
  add column if not exists mux_asset_id text,
  add column if not exists mux_playback_id text,
  add column if not exists mux_status text;

-- 업로드 직후에는 asset 이 아직 없다. Mux 가 인코딩을 끝내야 playback_id 가 생긴다.
-- waiting: 업로드 URL 만 만든 상태 / preparing: 인코딩 중 / ready: 재생 가능 / errored: 실패
alter table public.lessons
  drop constraint if exists lessons_mux_status_check;

alter table public.lessons
  add constraint lessons_mux_status_check
  check (
    mux_status is null
    or mux_status in ('waiting', 'preparing', 'ready', 'errored')
  );

-- 재생 가능한 차시는 playback_id 가 반드시 있어야 한다.
alter table public.lessons
  drop constraint if exists lessons_mux_ready_requires_playback_check;

alter table public.lessons
  add constraint lessons_mux_ready_requires_playback_check
  check (mux_status <> 'ready' or mux_playback_id is not null);

create index if not exists lessons_mux_upload_id_idx
  on public.lessons (mux_upload_id)
  where mux_upload_id is not null;

-- 반환 컬럼이 늘어나므로 replace 가 아니라 drop 후 재생성해야 한다.
drop function if exists public.get_course_video_manifest(text);

create function public.get_course_video_manifest(target_course_slug text)
returns table (
  lesson_key text,
  video_path text,
  video_provider text,
  mux_playback_id text,
  duration_seconds integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    lesson.lesson_key,
    lesson.video_path,
    case
      when lesson.mux_playback_id is not null then 'mux'
      when lesson.video_provider is not null then lesson.video_provider
      when lesson.video_path like '/videos/%' then 'local'
      else 'supabase'
    end,
    lesson.mux_playback_id,
    lesson.duration_seconds
  from public.lessons as lesson
  join public.course_sections as section on section.id = lesson.section_id
  join public.courses as course on course.id = section.course_id
  join public.products as product on product.id = course.product_id
  where course.slug = target_course_slug
    -- Mux 로 옮긴 차시는 video_path 가 비어 있다. 둘 중 하나만 있으면 재생 대상이다.
    and (
      lesson.video_path is not null
      or (lesson.mux_playback_id is not null and lesson.mux_status = 'ready')
    )
    and (
      public.is_admin()
      or (
        product.status <> 'archived'
        and course.status = 'published'
        and section.status = 'published'
        and lesson.status = 'published'
        and exists (
          select 1
          from public.product_entitlements as entitlement
          where entitlement.product_id = course.product_id
            and entitlement.user_id = (select auth.uid())
            and entitlement.status = 'active'
            and (entitlement.expires_at is null or entitlement.expires_at > now())
        )
      )
    )
  order by section.sort_order, lesson.sort_order;
$$;

revoke all on function public.get_course_video_manifest(text) from public;
grant execute on function public.get_course_video_manifest(text) to authenticated;
