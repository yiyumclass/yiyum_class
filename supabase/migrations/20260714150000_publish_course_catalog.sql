grant select on table public.courses to anon, authenticated;
grant select on table public.course_sections to anon, authenticated;
grant select on table public.lessons to anon, authenticated;

drop policy if exists "Public can view published courses" on public.courses;
create policy "Public can view published courses"
  on public.courses
  for select
  to anon, authenticated
  using (
    status = 'published'
    and exists (
      select 1
      from public.products
      where products.id = courses.product_id
        and products.product_type = 'course'
        and products.status = 'active'
    )
  );

drop policy if exists "Public can view published course sections"
  on public.course_sections;
create policy "Public can view published course sections"
  on public.course_sections
  for select
  to anon, authenticated
  using (
    status = 'published'
    and exists (
      select 1
      from public.courses
      join public.products on products.id = courses.product_id
      where courses.id = course_sections.course_id
        and courses.status = 'published'
        and products.product_type = 'course'
        and products.status = 'active'
    )
  );

drop policy if exists "Public can view published lessons" on public.lessons;
create policy "Public can view published lessons"
  on public.lessons
  for select
  to anon, authenticated
  using (
    status = 'published'
    and exists (
      select 1
      from public.course_sections
      join public.courses on courses.id = course_sections.course_id
      join public.products on products.id = courses.product_id
      where course_sections.id = lessons.section_id
        and course_sections.status = 'published'
        and courses.status = 'published'
        and products.product_type = 'course'
        and products.status = 'active'
    )
  );

comment on policy "Public can view published courses" on public.courses is
  '판매 중인 강의 상품과 연결된 공개 강의만 공개 카탈로그에 노출한다.';
