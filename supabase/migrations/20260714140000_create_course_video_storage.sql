alter table public.lessons
  add column if not exists video_provider text
    check (video_provider in ('local', 'supabase')),
  add column if not exists video_file_name text,
  add column if not exists video_content_type text,
  add column if not exists video_size_bytes bigint
    check (video_size_bytes is null or video_size_bytes >= 0),
  add column if not exists video_uploaded_at timestamptz;

comment on column public.lessons.video_provider is
  'local은 개발용 정적 파일, supabase는 course-videos 비공개 버킷의 객체를 의미한다.';
comment on column public.lessons.video_path is
  'video_provider가 supabase이면 course-videos 버킷 내부 객체 경로만 저장한다. 공개 URL은 저장하지 않는다.';
comment on column public.lessons.video_file_name is
  '관리자 화면에 표시할 업로드 당시 원본 파일명.';

update public.lessons
set video_provider = case
  when video_path like '/videos/%' then 'local'
  else 'supabase'
end
where video_path is not null
  and video_provider is null;

create unique index if not exists lessons_supabase_video_path_unique_idx
  on public.lessons (video_path)
  where video_provider = 'supabase' and video_path is not null;

insert into storage.buckets (
  id,
  name,
  public,
  allowed_mime_types
)
values (
  'course-videos',
  'course-videos',
  false,
  array['video/mp4']::text[]
)
on conflict (id) do update
set
  public = false,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_access_course_video(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.lessons as lesson
      join public.course_sections as section on section.id = lesson.section_id
      join public.courses as course on course.id = section.course_id
      where lesson.video_provider = 'supabase'
        and lesson.video_path = object_name
        and course.status = 'published'
        and section.status = 'published'
        and (lesson.status = 'published' or lesson.is_preview = true)
    );
$$;

comment on function public.can_access_course_video(text) is
  '비공개 강의 영상 접근의 단일 정책 진입점. 주문/수강권 도입 시 이 함수에 유효 수강권 검사를 추가한다.';

revoke all on function public.can_access_course_video(text) from public;
grant execute on function public.can_access_course_video(text) to authenticated;

create or replace function public.get_course_video_manifest(target_course_slug text)
returns table (
  lesson_key text,
  video_path text,
  video_provider text,
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
    coalesce(
      lesson.video_provider,
      case when lesson.video_path like '/videos/%' then 'local' else 'supabase' end
    ),
    lesson.duration_seconds
  from public.lessons as lesson
  join public.course_sections as section on section.id = lesson.section_id
  join public.courses as course on course.id = section.course_id
  where course.slug = target_course_slug
    and lesson.video_path is not null
    and (
      public.is_admin()
      or (
        course.status = 'published'
        and section.status = 'published'
        and (lesson.status = 'published' or lesson.is_preview = true)
      )
    )
  order by section.sort_order, lesson.sort_order;
$$;

comment on function public.get_course_video_manifest(text) is
  '현재 사용자에게 재생 가능한 차시의 내부 영상 위치만 반환한다. 공개 URL은 반환하지 않는다.';

revoke all on function public.get_course_video_manifest(text) from public;
grant execute on function public.get_course_video_manifest(text) to authenticated;

drop policy if exists "Admins can upload course videos"
  on storage.objects;
create policy "Admins can upload course videos"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'course-videos'
    and public.is_admin()
  );

drop policy if exists "Admins can inspect course videos"
  on storage.objects;
create policy "Admins can inspect course videos"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'course-videos'
    and public.is_admin()
  );

drop policy if exists "Admins can update course videos"
  on storage.objects;
create policy "Admins can update course videos"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'course-videos'
    and public.is_admin()
  )
  with check (
    bucket_id = 'course-videos'
    and public.is_admin()
  );

drop policy if exists "Admins can delete course videos"
  on storage.objects;
create policy "Admins can delete course videos"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'course-videos'
    and public.is_admin()
  );

drop policy if exists "Members can play available course videos"
  on storage.objects;
create policy "Members can play available course videos"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'course-videos'
    and public.can_access_course_video(name)
  );
