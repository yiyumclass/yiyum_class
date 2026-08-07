-- 품절은 판매 중지와 다르다. 판매 중지는 상품을 목록에서 내리지만, 품절은 카드를
-- 남겨두고 지금은 살 수 없다는 것만 알린다. 다음 기수를 기다리게 하려면 상품이
-- 보여야 한다. 정가는 세일가와 나란히 보여줘야 할인이라는 사실이 전달된다.

-- ---------------------------------------------------------------------------
-- 컬럼과 제약
-- ---------------------------------------------------------------------------

alter table public.products drop constraint if exists products_status_check;
alter table public.products add constraint products_status_check
  check (status in ('draft', 'active', 'sold_out', 'paused', 'archived'));

comment on column public.products.status is
  'draft 작성 중, active 판매 중, sold_out 품절(노출하되 결제 불가), paused 판매 중지(비노출), archived 보관.';

alter table public.products add column if not exists list_price_krw integer;

-- 정가가 판매가보다 낮으면 할인이 아니라 인상이다. 화면에서 취소선이 뒤집혀 보인다.
alter table public.products drop constraint if exists products_list_price_krw_check;
alter table public.products add constraint products_list_price_krw_check
  check (list_price_krw is null or list_price_krw >= price_krw);

comment on column public.products.list_price_krw is
  '할인 전 정가. null이면 세일이 아니다. 판매가보다 작을 수 없다.';

-- ---------------------------------------------------------------------------
-- 공개 노출 범위
-- 결제와 무료 신청은 create_toss_payment_order, claim_free_product 가 status =
-- 'active' 를 요구하므로 손대지 않는다. 품절은 노출만 열고 구매는 막힌 채 남는다.
-- ---------------------------------------------------------------------------

drop policy if exists "Public can view active products" on public.products;
drop policy if exists "Public can view sellable products" on public.products;
create policy "Public can view sellable products"
  on public.products
  for select
  to anon, authenticated
  using (status in ('active', 'sold_out'));

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
        and products.status in ('active', 'sold_out')
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
        and products.status in ('active', 'sold_out')
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
        and products.status in ('active', 'sold_out')
    )
  );

-- ---------------------------------------------------------------------------
-- 공개 DTO
-- ---------------------------------------------------------------------------

drop function if exists public.get_public_products(text);
create or replace function public.get_public_products(target_slug text default null)
returns table (
  id uuid,
  slug text,
  product_type text,
  title text,
  summary text,
  price_krw integer,
  list_price_krw integer,
  status text,
  access_period_days integer,
  thumbnail_path text,
  detail_path text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    product.id,
    product.slug,
    product.product_type,
    product.title,
    product.summary,
    product.price_krw,
    product.list_price_krw,
    product.status,
    product.access_period_days,
    product.thumbnail_path,
    product.detail_path
  from public.products as product
  where product.status in ('active', 'sold_out')
    and (
      target_slug is null
      or product.slug = target_slug
    )
  order by product.updated_at desc;
$$;

comment on function public.get_public_products(text) is
  '공개 판매 화면에 필요한 판매 중·품절 상품 DTO. 감사 및 내부 결제 컬럼은 반환하지 않는다.';

revoke all on function public.get_public_products(text) from public;
grant execute on function public.get_public_products(text) to anon, authenticated;

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
   and course.status = 'published'
  left join public.course_sections as section
    on section.course_id = course.id
   and section.status = 'published'
  left join public.lessons as lesson
    on lesson.section_id = section.id
   and lesson.status = 'published'
  where product.product_type = 'course'
    and product.status in ('active', 'sold_out')
  order by product.updated_at desc, section.sort_order, lesson.sort_order;
$$;

comment on function public.get_public_course_catalog_outline() is
  '판매 페이지에 표시할 공개 커리큘럼 개요. 판매 중·품절 상품의 published 콘텐츠만 반환하고 영상 경로는 노출하지 않는다.';

revoke all on function public.get_public_course_catalog_outline() from public;
grant execute on function public.get_public_course_catalog_outline() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 감사 로그
-- 가격 변경은 분쟁에서 가장 먼저 확인하는 기록이다. 정가도 같이 남긴다.
-- ---------------------------------------------------------------------------

create or replace function public.log_product_admin_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_metadata jsonb;
begin
  if tg_op = 'INSERT' then
    audit_metadata := jsonb_build_object(
      'slug', new.slug,
      'product_type', new.product_type,
      'status', new.status,
      'price_krw', new.price_krw,
      'list_price_krw', new.list_price_krw,
      'access_period_days', new.access_period_days
    );
  else
    audit_metadata := jsonb_build_object(
      'slug', new.slug,
      'product_type', new.product_type,
      'changed_fields', to_jsonb(array_remove(array[
        case when old.title is distinct from new.title then 'title' end,
        case when old.summary is distinct from new.summary then 'summary' end,
        case when old.price_krw is distinct from new.price_krw then 'price_krw' end,
        case when old.list_price_krw is distinct from new.list_price_krw then 'list_price_krw' end,
        case when old.access_period_days is distinct from new.access_period_days then 'access_period_days' end,
        case when old.status is distinct from new.status then 'status' end,
        case when old.thumbnail_path is distinct from new.thumbnail_path then 'thumbnail_path' end,
        case when old.detail_path is distinct from new.detail_path then 'detail_path' end
      ]::text[], null)),
      'before', jsonb_build_object(
        'title', old.title,
        'summary', old.summary,
        'price_krw', old.price_krw,
        'list_price_krw', old.list_price_krw,
        'access_period_days', old.access_period_days,
        'status', old.status,
        'thumbnail_path', old.thumbnail_path,
        'detail_path', old.detail_path
      ),
      'after', jsonb_build_object(
        'title', new.title,
        'summary', new.summary,
        'price_krw', new.price_krw,
        'list_price_krw', new.list_price_krw,
        'access_period_days', new.access_period_days,
        'status', new.status,
        'thumbnail_path', new.thumbnail_path,
        'detail_path', new.detail_path
      )
    );
  end if;

  insert into public.admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    (select auth.uid()),
    case tg_op
      when 'INSERT' then 'product.created'
      when 'UPDATE' then 'product.updated'
      else 'product.changed'
    end,
    'product',
    new.id::text,
    audit_metadata
  );

  return new;
end;
$$;

revoke all on function public.log_product_admin_change() from public;

comment on function public.log_product_admin_change() is
  '상품 등록·수정 시 변경 필드와 변경 전후 값을 관리자 감사 로그에 기록한다.';
