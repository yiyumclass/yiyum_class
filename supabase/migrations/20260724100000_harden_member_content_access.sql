-- Keep owned content available when product sales are paused, while keeping
-- draft/preview lessons out of member-facing catalog and video access.

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
    and product.status = 'active'
  order by product.updated_at desc, section.sort_order, lesson.sort_order;
$$;

comment on function public.get_public_course_catalog_outline() is
  '판매 페이지에 표시할 공개 커리큘럼 개요. 판매 중인 상품의 published 콘텐츠만 반환하고 영상 경로는 노출하지 않는다.';

revoke all on function public.get_public_course_catalog_outline() from public;
grant execute on function public.get_public_course_catalog_outline() to anon, authenticated;

create or replace function public.get_my_active_product_library()
returns table (
  product_slug text,
  product_type text,
  title text,
  summary text,
  access_period_days integer,
  detail_path text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    product.slug,
    product.product_type,
    product.title,
    product.summary,
    product.access_period_days,
    product.detail_path,
    entitlement.expires_at
  from public.product_entitlements as entitlement
  join public.products as product on product.id = entitlement.product_id
  where entitlement.user_id = (select auth.uid())
    and entitlement.status = 'active'
    and (entitlement.expires_at is null or entitlement.expires_at > now())
    and product.status <> 'archived'
  order by entitlement.granted_at desc;
$$;

comment on function public.get_my_active_product_library() is
  '내 보유 콘텐츠 목록. 판매 중지(paused) 상품도 기존 이용권이 있으면 반환하고 archived 상품은 제외한다.';

revoke all on function public.get_my_active_product_library() from public;
grant execute on function public.get_my_active_product_library() to authenticated;

create or replace function public.get_my_active_course_catalog_outline()
returns table (
  product_id uuid,
  product_slug text,
  product_title text,
  product_summary text,
  product_price_krw integer,
  product_access_period_days integer,
  product_thumbnail_path text,
  product_detail_path text,
  product_expires_at timestamptz,
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
    product.slug,
    product.title,
    product.summary,
    product.price_krw,
    product.access_period_days,
    product.thumbnail_path,
    product.detail_path,
    entitlement.expires_at,
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
  from public.product_entitlements as entitlement
  join public.products as product
    on product.id = entitlement.product_id
   and product.product_type = 'course'
   and product.status <> 'archived'
  join public.courses as course
    on course.product_id = product.id
   and course.status = 'published'
  left join public.course_sections as section
    on section.course_id = course.id
   and section.status = 'published'
  left join public.lessons as lesson
    on lesson.section_id = section.id
   and lesson.status = 'published'
  where entitlement.user_id = (select auth.uid())
    and entitlement.status = 'active'
    and (entitlement.expires_at is null or entitlement.expires_at > now())
  order by entitlement.granted_at desc, section.sort_order, lesson.sort_order;
$$;

comment on function public.get_my_active_course_catalog_outline() is
  '내 보유 강의 목차. 판매 중지(paused) 상품도 기존 이용권이 있으면 published 콘텐츠를 반환한다.';

revoke all on function public.get_my_active_course_catalog_outline() from public;
grant execute on function public.get_my_active_course_catalog_outline() to authenticated;

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
      join public.products as product on product.id = course.product_id
      join public.product_entitlements as entitlement
        on entitlement.product_id = course.product_id
       and entitlement.user_id = (select auth.uid())
       and entitlement.status = 'active'
       and (entitlement.expires_at is null or entitlement.expires_at > now())
      where lesson.video_provider = 'supabase'
        and lesson.video_path = object_name
        and product.status <> 'archived'
        and course.status = 'published'
        and section.status = 'published'
        and lesson.status = 'published'
    );
$$;

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
  join public.products as product on product.id = course.product_id
  where course.slug = target_course_slug
    and lesson.video_path is not null
    and (
      public.is_admin()
      or (
        product.status <> 'archived'
        and course.status = 'published'
        and section.status = 'published'
        and lesson.status = 'published'
        and exists (
          select 1
          from public.product_entitlements as entitlement
          where entitlement.product_id = course.product_id
            and entitlement.user_id = (select auth.uid())
            and entitlement.status = 'active'
            and (entitlement.expires_at is null or entitlement.expires_at > now())
        )
      )
    )
  order by section.sort_order, lesson.sort_order;
$$;

revoke all on function public.get_course_video_manifest(text) from public;
grant execute on function public.get_course_video_manifest(text) to authenticated;
