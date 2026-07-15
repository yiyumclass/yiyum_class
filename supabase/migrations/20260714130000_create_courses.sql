create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products(id) on delete restrict,
  slug text not null unique,
  title text not null,
  short_title text not null,
  description text not null default '',
  instructor text not null default '',
  poster_path text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint courses_slug_format_check
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint courses_title_length_check
    check (char_length(title) between 1 and 120),
  constraint courses_short_title_length_check
    check (char_length(short_title) between 1 and 80),
  constraint courses_description_length_check
    check (char_length(description) <= 1000),
  constraint courses_instructor_length_check
    check (char_length(instructor) <= 80)
);

create table if not exists public.course_sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  section_key text not null,
  title text not null,
  description text not null default '',
  sort_order integer not null default 0 check (sort_order >= 0),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_sections_key_format_check
    check (section_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint course_sections_title_length_check
    check (char_length(title) between 1 and 120),
  constraint course_sections_description_length_check
    check (char_length(description) <= 500),
  unique (course_id, section_key),
  unique (course_id, sort_order)
);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.course_sections(id) on delete cascade,
  lesson_key text not null,
  title text not null,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  video_path text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  is_preview boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lessons_key_format_check
    check (lesson_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint lessons_title_length_check
    check (char_length(title) between 1 and 180),
  unique (section_id, lesson_key),
  unique (section_id, sort_order)
);

comment on table public.courses is
  '판매 상품과 연결되는 VOD 강의 기본 정보. 가격과 이용 기간은 products에서 관리한다.';
comment on table public.course_sections is
  '강의의 챕터와 노출 순서.';
comment on table public.lessons is
  '챕터에 속한 VOD 차시. video_path는 공개 URL이 아니라 저장소 식별자 또는 내부 경로를 사용한다.';
comment on column public.lessons.status is
  'draft 준비 중, published 수강생 공개, archived 보관';

create index if not exists courses_status_updated_at_idx
  on public.courses (status, updated_at desc);
create index if not exists course_sections_course_sort_idx
  on public.course_sections (course_id, sort_order);
create index if not exists lessons_section_sort_idx
  on public.lessons (section_id, sort_order);
create index if not exists lessons_status_idx
  on public.lessons (status, updated_at desc);

create or replace function public.set_course_content_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.updated_by = (select auth.uid());
  return new;
end;
$$;

revoke all on function public.set_course_content_updated_at() from public;

drop trigger if exists courses_set_updated_at on public.courses;
create trigger courses_set_updated_at
  before update on public.courses
  for each row execute function public.set_course_content_updated_at();

drop trigger if exists course_sections_set_updated_at on public.course_sections;
create trigger course_sections_set_updated_at
  before update on public.course_sections
  for each row execute function public.set_course_content_updated_at();

drop trigger if exists lessons_set_updated_at on public.lessons;
create trigger lessons_set_updated_at
  before update on public.lessons
  for each row execute function public.set_course_content_updated_at();

alter table public.courses enable row level security;
alter table public.course_sections enable row level security;
alter table public.lessons enable row level security;

revoke all on table public.courses from anon, authenticated;
revoke all on table public.course_sections from anon, authenticated;
revoke all on table public.lessons from anon, authenticated;

grant select, insert, update on table public.courses to authenticated;
grant select, insert, update on table public.course_sections to authenticated;
grant select, insert, update on table public.lessons to authenticated;

drop policy if exists "Admins can view courses" on public.courses;
create policy "Admins can view courses"
  on public.courses
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Admins can create courses" on public.courses;
create policy "Admins can create courses"
  on public.courses
  for insert
  to authenticated
  with check (
    public.is_admin()
    and created_by = (select auth.uid())
  );

drop policy if exists "Admins can update courses" on public.courses;
create policy "Admins can update courses"
  on public.courses
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can view course sections" on public.course_sections;
create policy "Admins can view course sections"
  on public.course_sections
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Admins can create course sections" on public.course_sections;
create policy "Admins can create course sections"
  on public.course_sections
  for insert
  to authenticated
  with check (
    public.is_admin()
    and created_by = (select auth.uid())
  );

drop policy if exists "Admins can update course sections" on public.course_sections;
create policy "Admins can update course sections"
  on public.course_sections
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can view lessons" on public.lessons;
create policy "Admins can view lessons"
  on public.lessons
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Admins can create lessons" on public.lessons;
create policy "Admins can create lessons"
  on public.lessons
  for insert
  to authenticated
  with check (
    public.is_admin()
    and created_by = (select auth.uid())
  );

drop policy if exists "Admins can update lessons" on public.lessons;
create policy "Admins can update lessons"
  on public.lessons
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.log_course_content_admin_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  row_id text;
  record_title text;
  record_status text;
begin
  if actor_id is null then
    return new;
  end if;

  row_id := new.id::text;
  record_title := new.title;
  record_status := new.status;

  insert into public.admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    actor_id,
    tg_table_name || case when tg_op = 'INSERT' then '.created' else '.updated' end,
    tg_table_name,
    row_id,
    jsonb_build_object(
      'title', record_title,
      'status', record_status,
      'before', case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
      'after', to_jsonb(new)
    )
  );

  return new;
end;
$$;

revoke all on function public.log_course_content_admin_change() from public;

drop trigger if exists courses_write_audit_log on public.courses;
create trigger courses_write_audit_log
  after insert or update on public.courses
  for each row execute function public.log_course_content_admin_change();

drop trigger if exists course_sections_write_audit_log on public.course_sections;
create trigger course_sections_write_audit_log
  after insert or update on public.course_sections
  for each row execute function public.log_course_content_admin_change();

drop trigger if exists lessons_write_audit_log on public.lessons;
create trigger lessons_write_audit_log
  after insert or update on public.lessons
  for each row execute function public.log_course_content_admin_change();

create or replace function public.move_course_section(
  target_section_id uuid,
  move_direction integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.course_sections%rowtype;
  neighbor_row public.course_sections%rowtype;
  temporary_order integer;
begin
  if not public.is_admin() then
    raise exception 'administrator permission required';
  end if;
  if move_direction not in (-1, 1) then
    raise exception 'move_direction must be -1 or 1';
  end if;

  select * into current_row
  from public.course_sections
  where id = target_section_id
  for update;

  if not found then
    raise exception 'course section not found';
  end if;

  if move_direction = -1 then
    select * into neighbor_row
    from public.course_sections
    where course_id = current_row.course_id
      and sort_order < current_row.sort_order
    order by sort_order desc
    limit 1
    for update;
  else
    select * into neighbor_row
    from public.course_sections
    where course_id = current_row.course_id
      and sort_order > current_row.sort_order
    order by sort_order asc
    limit 1
    for update;
  end if;

  if not found then return; end if;

  select coalesce(max(sort_order), 0) + 1 into temporary_order
  from public.course_sections
  where course_id = current_row.course_id;

  update public.course_sections set sort_order = temporary_order where id = current_row.id;
  update public.course_sections set sort_order = current_row.sort_order where id = neighbor_row.id;
  update public.course_sections set sort_order = neighbor_row.sort_order where id = current_row.id;
end;
$$;

create or replace function public.move_lesson(
  target_lesson_id uuid,
  move_direction integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.lessons%rowtype;
  neighbor_row public.lessons%rowtype;
  temporary_order integer;
begin
  if not public.is_admin() then
    raise exception 'administrator permission required';
  end if;
  if move_direction not in (-1, 1) then
    raise exception 'move_direction must be -1 or 1';
  end if;

  select * into current_row
  from public.lessons
  where id = target_lesson_id
  for update;

  if not found then
    raise exception 'lesson not found';
  end if;

  if move_direction = -1 then
    select * into neighbor_row
    from public.lessons
    where section_id = current_row.section_id
      and sort_order < current_row.sort_order
    order by sort_order desc
    limit 1
    for update;
  else
    select * into neighbor_row
    from public.lessons
    where section_id = current_row.section_id
      and sort_order > current_row.sort_order
    order by sort_order asc
    limit 1
    for update;
  end if;

  if not found then return; end if;

  select coalesce(max(sort_order), 0) + 1 into temporary_order
  from public.lessons
  where section_id = current_row.section_id;

  update public.lessons set sort_order = temporary_order where id = current_row.id;
  update public.lessons set sort_order = current_row.sort_order where id = neighbor_row.id;
  update public.lessons set sort_order = neighbor_row.sort_order where id = current_row.id;
end;
$$;

revoke all on function public.move_course_section(uuid, integer) from public;
revoke all on function public.move_lesson(uuid, integer) from public;
grant execute on function public.move_course_section(uuid, integer) to authenticated;
grant execute on function public.move_lesson(uuid, integer) to authenticated;

insert into public.courses (
  product_id,
  slug,
  title,
  short_title,
  description,
  instructor,
  poster_path,
  status
)
select
  id,
  slug,
  '이윰 SNS 수익화 클래스',
  'SNS 수익화 클래스',
  '계정 세팅부터 콘텐츠, 알고리즘, 수익화와 브랜딩까지 작은 계정을 수익으로 연결하는 전 과정을 배웁니다.',
  '이윰',
  '/assets/profile.jpg',
  'draft'
from public.products
where slug = 'sns-monetization'
  and product_type = 'course'
on conflict (slug) do nothing;

insert into public.course_sections (
  course_id, section_key, title, description, sort_order, status
)
select c.id, seed.section_key, seed.title, seed.description, seed.sort_order, 'published'
from public.courses c
cross join (
  values
    ('account-setup', '계정 세팅', '수익화에 유리한 계정의 방향을 정하고, 프로필과 랜딩페이지까지 기본 구조를 완성합니다.', 1),
    ('content-basics', '콘텐츠 제작 기본기', '숏폼을 기획하고 촬영·편집하기 전에 필요한 장비와 기본 설정을 차근차근 익힙니다.', 2),
    ('algorithm', '알고리즘', '조회수에 영향을 주는 후킹과 소재 선정부터 게시 후 운영까지, 성장에 필요한 판단 기준을 정리합니다.', 3),
    ('monetization', '수익화 로드맵', '협찬을 찾고 제안하며 단가를 협상하는 과정을 실제 수익화 순서에 맞춰 살펴봅니다.', 4),
    ('branding', '찐팬 · 브랜딩', '일회성 조회수를 넘어 오래 남는 팬과 브랜드를 만들고, 수익화 이후의 운영 기반을 준비합니다.', 5)
) as seed(section_key, title, description, sort_order)
where c.slug = 'sns-monetization'
on conflict (course_id, section_key) do nothing;

insert into public.lessons (
  section_id,
  lesson_key,
  title,
  duration_seconds,
  video_path,
  status,
  sort_order
)
select
  section.id,
  seed.lesson_key,
  seed.title,
  seed.duration_seconds,
  seed.video_path,
  case when seed.video_path is null then 'draft' else 'published' end,
  seed.sort_order
from (
  values
    ('account-setup', 'sns-01', '크리에이터 카테고리 정복하기 — 진입장벽·시청자층·얼굴 노출', 532, '/videos/sns-account-01.mp4', 1),
    ('account-setup', 'sns-02', '계정 정체성 잡는 법 — 한 계정에 여러 주제 올려도 되나요?', 711, null, 2),
    ('account-setup', 'sns-03', '수익화를 위한 프로필 4줄 세팅법', 624, null, 3),
    ('account-setup', 'sns-04', '수익화 필수 랜딩페이지 만드는 법 · 올바른 사용법', 723, '/videos/sns-account-04.mp4', 4),
    ('account-setup', 'sns-05', '계정 날아가지 않게 취해야 하는 조치 6가지', 688, null, 5),
    ('account-setup', 'sns-06', 'SNS에서 마음껏 활동하려면 무조건 해야 하는 것', 557, null, 6),
    ('content-basics', 'sns-07', '숏폼 & 릴스 트렌드 분석', 773, null, 1),
    ('content-basics', 'sns-08', '촬영 전 기본 세팅값 — 카메라 화질, 촬영 비율', 645, null, 2),
    ('content-basics', 'sns-09', '촬영 장비 소개 — 삼각대, 마이크', 528, null, 3),
    ('content-basics', 'sns-10', '편집 프로그램 — 자막·효과음·목소리 넣는 법', 1052, null, 4),
    ('algorithm', 'sns-11', '알고리즘 타는 릴스의 비밀', 906, null, 1),
    ('algorithm', 'sns-12', '카테고리별 내적 욕망 자극하는 법', 758, null, 2),
    ('algorithm', 'sns-13', '떡상하는 릴스의 공통점', 834, null, 3),
    ('algorithm', 'sns-14', '빠르게 팔로워 늘리는 법', 695, null, 4),
    ('algorithm', 'sns-15', '알고리즘 부스터 켜는 사후 전략 7개', 967, null, 5),
    ('algorithm', 'sns-16', '초반 3초 후킹 생각하는 팁', 601, null, 6),
    ('algorithm', 'sns-17', '해시태그, 이렇게 쓰면 10년 뒤처진 겁니다', 543, null, 7),
    ('algorithm', 'sns-18', '콘텐츠 소재 무한대로 얻는 법', 788, null, 8),
    ('algorithm', 'sns-19', '광고 릴스 대본 써주는 최적화 프롬프트', 862, null, 9),
    ('algorithm', 'sns-20', '댓글 품앗이, 이렇게 하면 계정 나락 갑니다', 574, null, 10),
    ('monetization', 'sns-21', '수익화할 수 있는 10가지 루트', 1014, null, 1),
    ('monetization', 'sns-22', '팔로워 수 상관없이 100% 수익화 가능한 방법 (100명대도 가능)', 799, null, 2),
    ('monetization', 'sns-23', '구간별 협찬 로드맵 — 팔로워 몇 명부터 협찬이 들어올까?', 746, null, 3),
    ('monetization', 'sns-24', '단가 협상 실전편 — 원고료 얼마 받을 수 있을까?', 923, null, 4),
    ('monetization', 'sns-25', '광고 단가 10배 올리는 치트키 5가지', 812, null, 5),
    ('monetization', 'sns-26', '브랜드가 무조건 답장하는 이메일·DM 템플릿', 879, null, 6),
    ('monetization', 'sns-27', '체험단 사이트', 491, null, 7),
    ('monetization', 'sns-28', '협찬 받는 루트', 637, null, 8),
    ('branding', 'sns-29', '정보성으로 모은 팔로워를 찐팬으로 전환시키는 테크트리', 948, null, 1),
    ('branding', 'sns-30', '얼굴 공개 없이 수익화 잘하는 크리에이터의 공통점', 721, null, 2),
    ('branding', 'sns-31', '세금 관리 · 세무사 추천', 684, null, 3),
    ('branding', 'sns-32', '멘탈 관리', 608, null, 4)
) as seed(section_key, lesson_key, title, duration_seconds, video_path, sort_order)
join public.course_sections section
  on section.section_key = seed.section_key
join public.courses course
  on course.id = section.course_id
where course.slug = 'sns-monetization'
on conflict (section_id, lesson_key) do nothing;
