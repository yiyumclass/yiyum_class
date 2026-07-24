-- Anonymous visitors consume explicit DTO RPCs instead of selecting whole
-- catalog rows that include creator UUIDs and private media metadata.

create or replace function public.get_public_products(target_slug text default null)
returns table (
  id uuid,
  slug text,
  product_type text,
  title text,
  summary text,
  price_krw integer,
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
    product.access_period_days,
    product.thumbnail_path,
    product.detail_path
  from public.products as product
  where product.status = 'active'
    and (
      target_slug is null
      or product.slug = target_slug
    )
  order by product.updated_at desc;
$$;

comment on function public.get_public_products(text) is
  '공개 판매 화면에 필요한 active 상품 DTO. 감사 및 내부 결제 컬럼은 반환하지 않는다.';

revoke all on function public.get_public_products(text) from public;
grant execute on function public.get_public_products(text) to anon, authenticated;

revoke select on table public.products from anon;
revoke select on table public.courses from anon;
revoke select on table public.course_sections from anon;
revoke select on table public.lessons from anon;
