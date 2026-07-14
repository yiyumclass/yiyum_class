create table if not exists public.lesson_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  course_slug text not null,
  lesson_id text not null,
  last_position_seconds integer not null default 0,
  duration_seconds integer not null default 0,
  completed_at timestamptz,
  last_watched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, course_slug, lesson_id),
  constraint lesson_progress_course_slug_length
    check (char_length(course_slug) between 1 and 120),
  constraint lesson_progress_lesson_id_length
    check (char_length(lesson_id) between 1 and 120),
  constraint lesson_progress_position_nonnegative
    check (last_position_seconds >= 0),
  constraint lesson_progress_duration_nonnegative
    check (duration_seconds >= 0),
  constraint lesson_progress_position_within_duration
    check (
      duration_seconds = 0
      or last_position_seconds <= duration_seconds + 5
    )
);

comment on table public.lesson_progress is
  '사용자별 VOD 차시의 마지막 재생 위치와 완료 상태';
comment on column public.lesson_progress.last_position_seconds is
  '마지막으로 확인된 영상 재생 위치(초)';
comment on column public.lesson_progress.completed_at is
  '90% 이상 시청 또는 수동 완료 시각. 미완료이면 null';

create index if not exists lesson_progress_user_recent_idx
  on public.lesson_progress (user_id, last_watched_at desc);

alter table public.lesson_progress enable row level security;

revoke all on table public.lesson_progress from anon;
revoke all on table public.lesson_progress from authenticated;
grant select, insert, update on table public.lesson_progress to authenticated;

drop policy if exists "Users can view their own lesson progress"
  on public.lesson_progress;
create policy "Users can view their own lesson progress"
  on public.lesson_progress
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own lesson progress"
  on public.lesson_progress;
create policy "Users can create their own lesson progress"
  on public.lesson_progress
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own lesson progress"
  on public.lesson_progress;
create policy "Users can update their own lesson progress"
  on public.lesson_progress
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
