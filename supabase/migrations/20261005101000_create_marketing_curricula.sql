create or replace function public.is_valid_marketing_curriculum_chapters(next_chapters jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  chapter jsonb;
  item jsonb;
  chapter_key text;
  item_key text;
  chapter_title text;
  item_title text;
  item_kind text;
  lesson_number numeric;
  chapter_keys text[] := array[]::text[];
  item_keys text[] := array[]::text[];
  lesson_numbers integer[] := array[]::integer[];
  total_items integer := 0;
  trim_characters constant text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if jsonb_typeof(next_chapters) is distinct from 'array' then
    return false;
  end if;

  if jsonb_array_length(next_chapters) not between 1 and 30 then
    return false;
  end if;

  for chapter in select value from jsonb_array_elements(next_chapters)
  loop
    if jsonb_typeof(chapter) is distinct from 'object' then
      return false;
    end if;

    if not (chapter ?& array['key', 'title', 'items']::text[])
      or chapter - array['key', 'title', 'items']::text[] <> '{}'::jsonb
      or jsonb_typeof(chapter -> 'key') is distinct from 'string'
      or jsonb_typeof(chapter -> 'title') is distinct from 'string'
      or jsonb_typeof(chapter -> 'items') is distinct from 'array' then
      return false;
    end if;

    chapter_key := chapter ->> 'key';
    chapter_title := chapter ->> 'title';

    if chapter_key !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
      or chapter_key = any(chapter_keys)
      or char_length(chapter_title) not between 1 and 200
      or chapter_title <> btrim(chapter_title, trim_characters) then
      return false;
    end if;

    chapter_keys := array_append(chapter_keys, chapter_key);

    if jsonb_array_length(chapter -> 'items') not between 1 and 150 then
      return false;
    end if;

    total_items := total_items + jsonb_array_length(chapter -> 'items');
    if total_items > 300 then
      return false;
    end if;

    for item in select value from jsonb_array_elements(chapter -> 'items')
    loop
      if jsonb_typeof(item) is distinct from 'object' then
        return false;
      end if;

      if not (item ?& array['key', 'title', 'lessonNumber', 'kind']::text[])
        or item - array['key', 'title', 'lessonNumber', 'kind']::text[] <> '{}'::jsonb
        or jsonb_typeof(item -> 'key') is distinct from 'string'
        or jsonb_typeof(item -> 'title') is distinct from 'string'
        or jsonb_typeof(item -> 'kind') is distinct from 'string'
        or jsonb_typeof(item -> 'lessonNumber') not in ('number', 'null') then
        return false;
      end if;

      item_key := item ->> 'key';
      item_title := item ->> 'title';
      item_kind := item ->> 'kind';

      if item_key !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
        or item_key = any(item_keys)
        or char_length(item_title) not between 1 and 200
        or item_title <> btrim(item_title, trim_characters)
        or item_kind not in ('lesson', 'assignment') then
        return false;
      end if;

      item_keys := array_append(item_keys, item_key);

      if jsonb_typeof(item -> 'lessonNumber') = 'null' then
        if item_kind = 'lesson' then
          return false;
        end if;
      else
        lesson_number := (item ->> 'lessonNumber')::numeric;

        if lesson_number not between 1 and 999
          or lesson_number <> trunc(lesson_number) then
          return false;
        end if;

        if lesson_number::integer = any(lesson_numbers) then
          return false;
        end if;

        lesson_numbers := array_append(lesson_numbers, lesson_number::integer);
      end if;
    end loop;
  end loop;

  return true;
end;
$$;

revoke all on function public.is_valid_marketing_curriculum_chapters(jsonb)
  from public, anon, authenticated;

create table public.marketing_curricula (
  curriculum_key text primary key,
  chapters jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint marketing_curricula_key_check
    check (curriculum_key = 'sns-monetization'),
  constraint marketing_curricula_chapters_check
    check (public.is_valid_marketing_curriculum_chapters(chapters)),
  constraint marketing_curricula_version_check
    check (version >= 1)
);

alter table public.marketing_curricula enable row level security;

revoke all on table public.marketing_curricula from public, anon, authenticated;
grant select on table public.marketing_curricula to anon, authenticated;

create policy "Anyone can view marketing curricula"
  on public.marketing_curricula
  for select
  to anon, authenticated
  using (true);

create or replace function public.save_marketing_curriculum(
  target_key text,
  expected_version integer,
  next_chapters jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  previous_curriculum public.marketing_curricula%rowtype;
  saved_curriculum public.marketing_curricula%rowtype;
begin
  if actor_id is null or not public.is_admin(array['owner', 'operator']::text[]) then
    raise exception 'admin access required' using errcode = '42501';
  end if;

  if target_key is distinct from 'sns-monetization'
    or expected_version is null
    or expected_version < 1
    or not public.is_valid_marketing_curriculum_chapters(next_chapters) then
    raise exception 'invalid marketing curriculum payload' using errcode = '22023';
  end if;

  select curriculum.* into previous_curriculum
  from public.marketing_curricula as curriculum
  where curriculum.curriculum_key = target_key
  for update;

  if not found then
    raise exception 'marketing curriculum not found' using errcode = 'P0002';
  end if;

  if previous_curriculum.version <> expected_version then
    raise exception 'marketing curriculum version conflict' using errcode = '40001';
  end if;

  update public.marketing_curricula
  set
    chapters = next_chapters,
    version = previous_curriculum.version + 1,
    updated_at = now(),
    updated_by = actor_id
  where curriculum_key = target_key
  returning * into saved_curriculum;

  insert into public.admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    actor_id,
    'marketing_curriculum.update',
    'marketing_curriculum',
    target_key,
    jsonb_build_object(
      'before', to_jsonb(previous_curriculum),
      'after', to_jsonb(saved_curriculum)
    )
  );

  return saved_curriculum.version;
end;
$$;

revoke all on function public.save_marketing_curriculum(text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_marketing_curriculum(text, integer, jsonb)
  to authenticated;
