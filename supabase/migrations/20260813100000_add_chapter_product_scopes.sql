-- A product is a sale unit; a course is reusable learning content. Keeping this
-- relation explicit lets several products sell the full course or selected chapters.

create table public.product_course_scopes (
  product_id uuid primary key references public.products(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  access_mode text not null default 'full' check (access_mode in ('full', 'selected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index product_course_scopes_course_idx
  on public.product_course_scopes (course_id);

create table public.product_course_scope_sections (
  product_id uuid not null references public.product_course_scopes(product_id) on delete cascade,
  section_id uuid not null references public.course_sections(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, section_id)
);

comment on table public.product_course_scopes is
  '강의 상품과 재사용 가능한 원본 강의의 판매 범위(full 또는 selected)를 연결한다.';
comment on table public.product_course_scope_sections is
  'selected 강의 상품에 포함되는 챕터. full 상품은 이 목록을 사용하지 않는다.';

create or replace function public.validate_product_course_scope_section()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.product_course_scopes scope
    join public.course_sections section on section.id = new.section_id
    where scope.product_id = new.product_id
      and scope.course_id = section.course_id
      and scope.access_mode = 'selected'
  ) then
    raise exception 'selected chapter must belong to the scoped course'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger validate_product_course_scope_section_before_write
before insert or update on public.product_course_scope_sections
for each row execute function public.validate_product_course_scope_section();

insert into public.product_course_scopes (product_id, course_id, access_mode)
select course.product_id, course.id, 'full'
from public.courses as course
on conflict (product_id) do nothing;

create or replace function public.seed_primary_course_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.product_course_scopes (product_id, course_id, access_mode)
  values (new.product_id, new.id, 'full')
  on conflict (product_id) do nothing;
  return new;
end;
$$;

drop trigger if exists seed_primary_course_scope_after_insert on public.courses;
create trigger seed_primary_course_scope_after_insert
after insert on public.courses
for each row execute function public.seed_primary_course_scope();

alter table public.product_course_scopes enable row level security;
alter table public.product_course_scope_sections enable row level security;
revoke all on table public.product_course_scopes from anon, authenticated;
revoke all on table public.product_course_scope_sections from anon, authenticated;
grant select, insert, update, delete on table public.product_course_scopes to authenticated;
grant select, insert, update, delete on table public.product_course_scope_sections to authenticated;

create policy "Admins manage course sale scopes"
  on public.product_course_scopes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage selected course chapters"
  on public.product_course_scope_sections for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.admin_set_product_course_scope(
  target_product_id uuid,
  target_course_id uuid,
  target_access_mode text,
  target_section_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if target_access_mode not in ('full', 'selected') then
    raise exception 'invalid course access mode' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.products
    where id = target_product_id and product_type = 'course'
  ) or not exists (select 1 from public.courses where id = target_course_id) then
    raise exception 'course product or course not found' using errcode = 'P0002';
  end if;
  if target_access_mode = 'selected' and coalesce(array_length(target_section_ids, 1), 0) = 0 then
    raise exception 'select at least one chapter' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(target_section_ids) as requested(section_id)
    where not exists (
      select 1 from public.course_sections
      where id = requested.section_id and course_id = target_course_id
    )
  ) then
    raise exception 'chapter does not belong to course' using errcode = '22023';
  end if;

  insert into public.product_course_scopes (product_id, course_id, access_mode, updated_at)
  values (target_product_id, target_course_id, target_access_mode, now())
  on conflict (product_id) do update set
    course_id = excluded.course_id,
    access_mode = excluded.access_mode,
    updated_at = now();

  delete from public.product_course_scope_sections where product_id = target_product_id;
  if target_access_mode = 'selected' then
    insert into public.product_course_scope_sections (product_id, section_id)
    select target_product_id, section_id from unnest(target_section_ids) as chosen(section_id)
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.admin_set_product_course_scope(uuid, uuid, text, uuid[]) from public;
grant execute on function public.admin_set_product_course_scope(uuid, uuid, text, uuid[]) to authenticated;

create or replace function public.get_public_course_catalog_outline()
returns table (
  product_id uuid, course_id uuid, course_slug text, course_title text,
  course_short_title text, course_description text, course_instructor text,
  course_poster_path text, course_status text, section_id uuid, section_key text,
  section_title text, section_description text, section_sort_order integer,
  section_status text, lesson_key text, lesson_title text,
  lesson_duration_seconds integer, lesson_sort_order integer, lesson_status text
)
language sql stable security definer set search_path = ''
as $$
  select product.id, course.id, course.slug, course.title, course.short_title,
    course.description, course.instructor, course.poster_path, course.status,
    section.id, section.section_key, section.title, section.description,
    section.sort_order, section.status, lesson.lesson_key, lesson.title,
    lesson.duration_seconds, lesson.sort_order, lesson.status
  from public.products as product
  join public.product_course_scopes as scope on scope.product_id = product.id
  join public.courses as course on course.id = scope.course_id and course.status = 'published'
  left join public.course_sections as section
    on section.course_id = course.id and section.status = 'published'
   and (scope.access_mode = 'full' or exists (
     select 1 from public.product_course_scope_sections chosen
     where chosen.product_id = product.id and chosen.section_id = section.id
   ))
  left join public.lessons as lesson on lesson.section_id = section.id and lesson.status = 'published'
  where product.product_type = 'course' and product.status in ('active', 'sold_out')
  order by product.updated_at desc, section.sort_order, lesson.sort_order;
$$;
revoke all on function public.get_public_course_catalog_outline() from public;
grant execute on function public.get_public_course_catalog_outline() to anon, authenticated;

create or replace function public.get_my_active_course_catalog_outline()
returns table (
  product_id uuid, product_slug text, product_title text, product_summary text,
  product_price_krw integer, product_access_period_days integer,
  product_thumbnail_path text, product_detail_path text, product_expires_at timestamptz,
  course_id uuid, course_slug text, course_title text, course_short_title text,
  course_description text, course_instructor text, course_poster_path text,
  course_status text, section_id uuid, section_key text, section_title text,
  section_description text, section_sort_order integer, section_status text,
  lesson_key text, lesson_title text, lesson_duration_seconds integer,
  lesson_sort_order integer, lesson_status text
)
language sql stable security definer set search_path = ''
as $$
  select product.id, product.slug, product.title, product.summary, product.price_krw,
    product.access_period_days, product.thumbnail_path, product.detail_path,
    entitlement.expires_at, course.id, course.slug, course.title, course.short_title,
    course.description, course.instructor, course.poster_path, course.status,
    section.id, section.section_key, section.title, section.description,
    section.sort_order, section.status, lesson.lesson_key, lesson.title,
    lesson.duration_seconds, lesson.sort_order, lesson.status
  from public.product_entitlements entitlement
  join public.products product on product.id = entitlement.product_id
    and product.product_type = 'course' and product.status <> 'archived'
  join public.product_course_scopes scope on scope.product_id = product.id
  join public.courses course on course.id = scope.course_id and course.status = 'published'
  left join public.course_sections section
    on section.course_id = course.id and section.status = 'published'
   and (scope.access_mode = 'full' or exists (
     select 1 from public.product_course_scope_sections chosen
     where chosen.product_id = product.id and chosen.section_id = section.id
   ))
  left join public.lessons lesson on lesson.section_id = section.id and lesson.status = 'published'
  where entitlement.user_id = (select auth.uid()) and entitlement.status = 'active'
    and (entitlement.expires_at is null or entitlement.expires_at > now())
  order by entitlement.granted_at desc, section.sort_order, lesson.sort_order;
$$;
revoke all on function public.get_my_active_course_catalog_outline() from public;
grant execute on function public.get_my_active_course_catalog_outline() to authenticated;

create or replace function public.can_access_course_video(object_name text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1 from public.lessons lesson
    join public.course_sections section on section.id = lesson.section_id
    join public.courses course on course.id = section.course_id
    join public.product_course_scopes scope on scope.course_id = course.id
      and (scope.access_mode = 'full' or exists (
        select 1 from public.product_course_scope_sections chosen
        where chosen.product_id = scope.product_id and chosen.section_id = section.id
      ))
    join public.products product on product.id = scope.product_id and product.status <> 'archived'
    join public.product_entitlements entitlement on entitlement.product_id = scope.product_id
      and entitlement.user_id = (select auth.uid()) and entitlement.status = 'active'
      and (entitlement.expires_at is null or entitlement.expires_at > now())
    where lesson.video_provider = 'supabase' and lesson.video_path = object_name
      and course.status = 'published' and section.status = 'published' and lesson.status = 'published'
  );
$$;
revoke all on function public.can_access_course_video(text) from public;
grant execute on function public.can_access_course_video(text) to authenticated;

drop function if exists public.get_course_video_manifest(text);
create function public.get_course_video_manifest(target_course_slug text)
returns table (
  lesson_key text, video_path text, video_provider text,
  mux_playback_id text, duration_seconds integer
)
language sql stable security definer set search_path = ''
as $$
  select lesson.lesson_key, lesson.video_path,
    case when lesson.mux_playback_id is not null then 'mux'
      when lesson.video_provider is not null then lesson.video_provider
      when lesson.video_path like '/videos/%' then 'local' else 'supabase' end,
    lesson.mux_playback_id, lesson.duration_seconds
  from public.lessons lesson
  join public.course_sections section on section.id = lesson.section_id
  join public.courses course on course.id = section.course_id
  where course.slug = target_course_slug
    and (lesson.video_path is not null or (lesson.mux_playback_id is not null and lesson.mux_status = 'ready'))
    and (public.is_admin() or (
      course.status = 'published' and section.status = 'published' and lesson.status = 'published'
      and exists (
        select 1 from public.product_course_scopes scope
        join public.products product on product.id = scope.product_id and product.status <> 'archived'
        join public.product_entitlements entitlement on entitlement.product_id = scope.product_id
          and entitlement.user_id = (select auth.uid()) and entitlement.status = 'active'
          and (entitlement.expires_at is null or entitlement.expires_at > now())
        where scope.course_id = course.id and (scope.access_mode = 'full' or exists (
          select 1 from public.product_course_scope_sections chosen
          where chosen.product_id = scope.product_id and chosen.section_id = section.id
        ))
      )
    ))
  order by section.sort_order, lesson.sort_order;
$$;
revoke all on function public.get_course_video_manifest(text) from public;
grant execute on function public.get_course_video_manifest(text) to authenticated;

create or replace function public.save_my_lesson_progress(
  target_course_slug text, target_lesson_id text, target_position_seconds integer,
  target_duration_seconds integer, target_completion_action text
)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_course_id uuid; target_section_id uuid; stored_duration_seconds integer;
  normalized_duration_seconds integer; normalized_position_seconds integer;
  saved_at timestamptz := now(); next_completed_at timestamptz;
begin
  if actor_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if target_completion_action not in ('preserve', 'complete', 'incomplete') then
    raise exception 'invalid completion action' using errcode = '22023';
  end if;
  if target_course_slug is null or target_lesson_id is null or target_position_seconds is null
    or target_duration_seconds is null or target_position_seconds < 0 or target_duration_seconds < 0 then
    raise exception 'invalid lesson progress' using errcode = '22023';
  end if;

  select course.id, section.id, lesson.duration_seconds
    into target_course_id, target_section_id, stored_duration_seconds
  from public.lessons lesson
  join public.course_sections section on section.id = lesson.section_id
  join public.courses course on course.id = section.course_id
  where course.slug = target_course_slug and lesson.lesson_key = target_lesson_id
    and (public.is_admin() or (course.status = 'published' and section.status = 'published' and lesson.status = 'published'));
  if not found then raise exception 'lesson not found' using errcode = 'P0002'; end if;

  if not public.is_admin() and not exists (
    select 1 from public.product_course_scopes scope
    join public.products product on product.id = scope.product_id and product.status <> 'archived'
    join public.product_entitlements entitlement on entitlement.product_id = scope.product_id
      and entitlement.user_id = actor_id and entitlement.status = 'active'
      and (entitlement.expires_at is null or entitlement.expires_at > saved_at)
    where scope.course_id = target_course_id and (scope.access_mode = 'full' or exists (
      select 1 from public.product_course_scope_sections chosen
      where chosen.product_id = scope.product_id and chosen.section_id = target_section_id
    ))
  ) then raise exception 'active entitlement required' using errcode = '42501'; end if;

  normalized_duration_seconds := greatest(0, least(target_duration_seconds, stored_duration_seconds + 5));
  normalized_position_seconds := greatest(0, least(target_position_seconds, normalized_duration_seconds));
  if target_completion_action = 'complete' then next_completed_at := saved_at; end if;
  insert into public.lesson_progress (user_id, course_slug, lesson_id, last_position_seconds,
    duration_seconds, completed_at, last_watched_at, updated_at)
  values (actor_id, target_course_slug, target_lesson_id, normalized_position_seconds,
    normalized_duration_seconds, next_completed_at, saved_at, saved_at)
  on conflict (user_id, course_slug, lesson_id) do update set
    last_position_seconds = excluded.last_position_seconds,
    duration_seconds = excluded.duration_seconds,
    completed_at = case when target_completion_action = 'complete' then saved_at
      when target_completion_action = 'incomplete' then null else public.lesson_progress.completed_at end,
    last_watched_at = saved_at, updated_at = saved_at;
  return saved_at;
end;
$$;
revoke all on function public.save_my_lesson_progress(text, text, integer, integer, text) from public, anon;
grant execute on function public.save_my_lesson_progress(text, text, integer, integer, text) to authenticated;
