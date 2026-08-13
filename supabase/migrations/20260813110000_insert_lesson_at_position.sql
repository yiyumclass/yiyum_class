-- Insert a lesson at an administrator-selected position in one transaction.
-- Existing lesson keys never change; only their display order is shifted.

create or replace function public.admin_create_lesson_at_position(
  target_section_id uuid,
  target_after_lesson_id uuid,
  target_lesson_key text,
  target_title text,
  target_duration_seconds integer,
  target_status text,
  target_is_preview boolean
)
returns table (
  id uuid,
  lesson_key text,
  title text,
  duration_seconds integer,
  status text,
  is_preview boolean,
  sort_order integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  insertion_order integer;
  largest_order integer;
  temporary_offset integer;
begin
  if not public.is_admin() then
    raise exception 'administrator permission required' using errcode = '42501';
  end if;

  -- Serializes inserts and moves within this chapter while the new order is built.
  perform 1
  from public.course_sections
  where public.course_sections.id = target_section_id
  for update;
  if not found then
    raise exception 'course section not found' using errcode = 'P0002';
  end if;

  if target_after_lesson_id is null then
    select coalesce(min(existing.sort_order), 0)
      into insertion_order
    from public.lessons as existing
    where existing.section_id = target_section_id;
  else
    select existing.sort_order + 1
      into insertion_order
    from public.lessons as existing
    where existing.id = target_after_lesson_id
      and existing.section_id = target_section_id;
    if not found then
      raise exception 'reference lesson not found in section' using errcode = '22023';
    end if;
  end if;

  select coalesce(max(existing.sort_order), 0)
    into largest_order
  from public.lessons as existing
  where existing.section_id = target_section_id;
  temporary_offset := largest_order + 1000000;

  -- The unique(section_id, sort_order) constraint requires a temporary range.
  update public.lessons as existing
  set sort_order = existing.sort_order + temporary_offset
  where existing.section_id = target_section_id
    and existing.sort_order >= insertion_order;

  update public.lessons as existing
  set sort_order = existing.sort_order - temporary_offset + 1
  where existing.section_id = target_section_id
    and existing.sort_order >= insertion_order + temporary_offset;

  return query
  insert into public.lessons as created (
    section_id,
    lesson_key,
    title,
    duration_seconds,
    video_path,
    status,
    is_preview,
    sort_order,
    created_by,
    updated_by
  ) values (
    target_section_id,
    target_lesson_key,
    target_title,
    target_duration_seconds,
    null,
    target_status,
    target_is_preview,
    insertion_order,
    (select auth.uid()),
    (select auth.uid())
  )
  returning
    created.id,
    created.lesson_key,
    created.title,
    created.duration_seconds,
    created.status,
    created.is_preview,
    created.sort_order,
    created.updated_at;
end;
$$;

comment on function public.admin_create_lesson_at_position(uuid, uuid, text, text, integer, text, boolean) is
  '관리자가 선택한 기존 차시 다음 위치에 새 차시를 원자적으로 삽입하고 나머지 표시 순서를 민다.';

revoke all on function public.admin_create_lesson_at_position(uuid, uuid, text, text, integer, text, boolean)
  from public, anon;
grant execute on function public.admin_create_lesson_at_position(uuid, uuid, text, text, integer, text, boolean)
  to authenticated;
