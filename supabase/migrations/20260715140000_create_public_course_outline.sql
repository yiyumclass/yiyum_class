create or replace function public.get_public_course_catalog_outline()
returns table (
  product_id uuid,
  course_id uuid,
  course_slug text,
  course_title text,
  course_short_title text,
  course_description text,
  course_instructor text,
  course_poster_path text,
  course_status text,
  section_id uuid,
  section_key text,
  section_title text,
  section_description text,
  section_sort_order integer,
  section_status text,
  lesson_key text,
  lesson_title text,
  lesson_duration_seconds integer,
  lesson_sort_order integer,
  lesson_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    product.id,
    course.id,
    course.slug,
    course.title,
    course.short_title,
    course.description,
    course.instructor,
    course.poster_path,
    course.status,
    section.id,
    section.section_key,
    section.title,
    section.description,
    section.sort_order,
    section.status,
    lesson.lesson_key,
    lesson.title,
    lesson.duration_seconds,
    lesson.sort_order,
    lesson.status
  from public.products as product
  join public.courses as course
    on course.product_id = product.id
   and course.status <> 'archived'
  left join public.course_sections as section
    on section.course_id = course.id
   and section.status <> 'archived'
  left join public.lessons as lesson
    on lesson.section_id = section.id
   and lesson.status <> 'archived'
  where product.product_type = 'course'
    and product.status = 'active'
  order by product.updated_at desc, section.sort_order, lesson.sort_order;
$$;

comment on function public.get_public_course_catalog_outline() is
  '판매 페이지에 표시할 안전한 커리큘럼 개요. 보관 콘텐츠는 제외하고 영상 경로는 노출하지 않는다.';

revoke all on function public.get_public_course_catalog_outline() from public;
grant execute on function public.get_public_course_catalog_outline() to anon, authenticated;
