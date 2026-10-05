create table if not exists public.lesson_descriptions (
  lesson_id uuid primary key references public.lessons(id) on delete cascade,
  description text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lesson_descriptions_length_check
    check (char_length(description) <= 10000)
);

alter table public.lesson_descriptions enable row level security;
revoke all on table public.lesson_descriptions from public, anon, authenticated;
grant select, insert, update on table public.lesson_descriptions to authenticated;

create or replace function public.can_read_lesson_description(target_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1
    from public.lessons as lesson
    join public.course_sections as section on section.id = lesson.section_id
    join public.courses as course on course.id = section.course_id
    join public.product_course_scopes as scope on scope.course_id = course.id
      and (scope.access_mode = 'full' or exists (
        select 1
        from public.product_course_scope_sections as chosen
        where chosen.product_id = scope.product_id and chosen.section_id = section.id
      ))
    join public.products as product on product.id = scope.product_id
      and product.product_type = 'course' and product.status <> 'archived'
    join public.product_entitlements as entitlement on entitlement.product_id = product.id
      and entitlement.user_id = (select auth.uid())
      and entitlement.status = 'active'
      and (entitlement.expires_at is null or entitlement.expires_at > now())
    where lesson.id = target_lesson_id
      and lesson.status = 'published'
      and section.status = 'published'
      and course.status = 'published'
  );
$$;

revoke all on function public.can_read_lesson_description(uuid) from public, anon, authenticated;
grant execute on function public.can_read_lesson_description(uuid) to authenticated;

drop policy if exists "Entitled members can read lesson descriptions" on public.lesson_descriptions;
create policy "Entitled members can read lesson descriptions"
  on public.lesson_descriptions for select to authenticated
  using (public.can_read_lesson_description(lesson_id));

drop policy if exists "Admins can create lesson descriptions" on public.lesson_descriptions;
create policy "Admins can create lesson descriptions"
  on public.lesson_descriptions for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Admins can update lesson descriptions" on public.lesson_descriptions;
create policy "Admins can update lesson descriptions"
  on public.lesson_descriptions for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop trigger if exists lesson_descriptions_set_updated_at on public.lesson_descriptions;
create trigger lesson_descriptions_set_updated_at
  before update on public.lesson_descriptions
  for each row execute function public.set_course_content_updated_at();

create or replace function public.log_lesson_description_admin_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  record_title text;
  record_key text;
begin
  if actor_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.description is not distinct from new.description then
    return new;
  end if;

  select lesson.title, lesson.lesson_key into record_title, record_key
  from public.lessons as lesson where lesson.id = new.lesson_id;

  insert into public.admin_audit_logs (
    actor_user_id, action, target_type, target_id, metadata
  ) values (
    actor_id, 'lessons.description_updated', 'lessons', new.lesson_id::text,
    jsonb_build_object(
      'title', record_title,
      'lesson_key', record_key,
      'before', jsonb_build_object('description', case when tg_op = 'UPDATE' then old.description else '' end),
      'after', jsonb_build_object('description', new.description)
    )
  );

  return new;
end;
$$;

revoke all on function public.log_lesson_description_admin_change() from public, anon, authenticated;

drop trigger if exists lesson_descriptions_write_audit_log on public.lesson_descriptions;
create trigger lesson_descriptions_write_audit_log
  after insert or update on public.lesson_descriptions
  for each row execute function public.log_lesson_description_admin_change();

create or replace function public.get_course_lesson_descriptions(target_course_slug text)
returns table (section_key text, lesson_key text, description text)
language sql
stable
security definer
set search_path = ''
as $$
  select section.section_key, lesson.lesson_key, content.description
  from public.lesson_descriptions as content
  join public.lessons as lesson on lesson.id = content.lesson_id
  join public.course_sections as section on section.id = lesson.section_id
  join public.courses as course on course.id = section.course_id
  where course.slug = target_course_slug
    and public.can_read_lesson_description(lesson.id)
  order by section.sort_order, lesson.sort_order;
$$;

revoke all on function public.get_course_lesson_descriptions(text) from public, anon, authenticated;
grant execute on function public.get_course_lesson_descriptions(text) to authenticated;

notify pgrst, 'reload schema';
