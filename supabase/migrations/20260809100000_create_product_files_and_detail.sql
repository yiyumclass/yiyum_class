-- 무료 자료는 강의와 달리 계속 늘어난다. 자료 하나 올릴 때마다 개발자를 불러야
-- 하면 배포 속도가 자료 추가 속도를 못 따라간다. 상세 내용을 데이터로 두어
-- 운영자가 직접 채우게 한다.

-- ---------------------------------------------------------------------------
-- 자료 파일과 소개문
-- ---------------------------------------------------------------------------

alter table public.products
  add column if not exists detail_body text,
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists file_content_type text,
  add column if not exists file_size_bytes bigint
    check (file_size_bytes is null or file_size_bytes >= 0),
  add column if not exists file_uploaded_at timestamptz;

comment on column public.products.detail_body is
  '상세 페이지 소개 문단. 빈 줄로 문단을 나눈다.';
comment on column public.products.file_path is
  'product-files 비공개 버킷 내부 경로만 저장한다. 공개 URL은 저장하지 않는다.';
comment on column public.products.file_name is
  '내려받을 때 쓸 원본 파일명.';

-- 같은 객체가 두 상품에 걸리면 하나를 지울 때 다른 하나가 조용히 깨진다.
create unique index if not exists products_file_path_unique_idx
  on public.products (file_path)
  where file_path is not null;

-- ---------------------------------------------------------------------------
-- 상세 항목
-- "이런 게 들어있어요" 처럼 제목과 설명이 반복되는 줄. 챕터·차시와 같은 모양이라
-- 관리자 화면도 같은 조작(추가·순서 변경·삭제)으로 다룰 수 있다.
-- ---------------------------------------------------------------------------

create table if not exists public.product_detail_items (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null
    references public.products (id) on delete cascade,
  sort_order integer not null default 0,
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.product_detail_items is
  '상품 상세에 반복해 나오는 항목. 자료 구성 안내에 쓴다.';

create index if not exists product_detail_items_product_sort_idx
  on public.product_detail_items (product_id, sort_order);

create or replace function public.set_product_detail_items_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists product_detail_items_set_updated_at
  on public.product_detail_items;
create trigger product_detail_items_set_updated_at
  before update on public.product_detail_items
  for each row execute function public.set_product_detail_items_updated_at();

alter table public.product_detail_items enable row level security;

revoke all on table public.product_detail_items from anon, authenticated;
grant select on table public.product_detail_items to authenticated;
grant insert, update, delete on table public.product_detail_items to authenticated;

drop policy if exists "Public can view sellable product detail items"
  on public.product_detail_items;
create policy "Public can view sellable product detail items"
  on public.product_detail_items
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.products
      where products.id = product_detail_items.product_id
        and products.status in ('active', 'sold_out')
    )
  );

drop policy if exists "Admins can manage product detail items"
  on public.product_detail_items;
create policy "Admins can manage product detail items"
  on public.product_detail_items
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 자료 파일 보관함
-- 무료 자료의 목적은 회원 확보다. 주소가 새면 그 목적이 무너지므로 버킷은
-- 비공개로 두고, 내려받기는 이용권을 확인한 뒤 서명 주소로만 내보낸다.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, allowed_mime_types)
values (
  'product-files',
  'product-files',
  false,
  array[
    'application/pdf',
    'application/zip',
    'application/x-zip-compressed',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    -- 페이지 미리보기 이미지도 같은 버킷에 들어간다
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
on conflict (id) do update
set
  public = false,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_access_product_file(object_name text)
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
      from public.products as product
      join public.product_entitlements as entitlement
        on entitlement.product_id = product.id
      where product.file_path = object_name
        and entitlement.user_id = (select auth.uid())
        and entitlement.status = 'active'
        and (entitlement.expires_at is null or entitlement.expires_at > now())
    );
$$;

comment on function public.can_access_product_file(text) is
  '이용권을 가진 회원과 관리자만 자료 파일에 접근할 수 있는지 판정한다.';

revoke all on function public.can_access_product_file(text) from public;
grant execute on function public.can_access_product_file(text) to authenticated;

drop policy if exists "Admins can upload product files" on storage.objects;
create policy "Admins can upload product files"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'product-files' and public.is_admin());

drop policy if exists "Admins can update product files" on storage.objects;
create policy "Admins can update product files"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'product-files' and public.is_admin())
  with check (bucket_id = 'product-files' and public.is_admin());

drop policy if exists "Admins can delete product files" on storage.objects;
create policy "Admins can delete product files"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'product-files' and public.is_admin());

drop policy if exists "Entitled members can read product files" on storage.objects;
create policy "Entitled members can read product files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'product-files'
    and public.can_access_product_file(name)
  );

-- ---------------------------------------------------------------------------
-- 내려받기용 DTO
-- 공개 목록에는 파일 경로를 싣지 않는다. 이용권을 가진 사람에게만 내준다.
-- ---------------------------------------------------------------------------

create or replace function public.get_my_product_file(target_product_slug text)
returns table (
  file_path text,
  file_name text,
  file_content_type text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    product.file_path,
    product.file_name,
    product.file_content_type
  from public.products as product
  join public.product_entitlements as entitlement
    on entitlement.product_id = product.id
  where product.slug = target_product_slug
    and product.file_path is not null
    and entitlement.user_id = (select auth.uid())
    and entitlement.status = 'active'
    and (entitlement.expires_at is null or entitlement.expires_at > now())
  limit 1;
$$;

comment on function public.get_my_product_file(text) is
  '이용권을 가진 회원에게만 자료 파일의 내부 위치를 반환한다. 공개 URL은 반환하지 않는다.';

revoke all on function public.get_my_product_file(text) from public;
grant execute on function public.get_my_product_file(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 공개 DTO 갱신
-- 소개문은 판매 화면에 필요하다. 파일 경로는 여전히 싣지 않는다.
-- ---------------------------------------------------------------------------

drop function if exists public.get_public_products(text);
create or replace function public.get_public_products(target_slug text default null)
returns table (
  id uuid,
  slug text,
  product_type text,
  title text,
  summary text,
  detail_body text,
  price_krw integer,
  list_price_krw integer,
  status text,
  access_period_days integer,
  thumbnail_path text,
  detail_path text,
  has_file boolean
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
    product.detail_body,
    product.price_krw,
    product.list_price_krw,
    product.status,
    product.access_period_days,
    product.thumbnail_path,
    product.detail_path,
    product.file_path is not null
  from public.products as product
  where product.status in ('active', 'sold_out')
    and (
      target_slug is null
      or product.slug = target_slug
    )
  order by product.updated_at desc;
$$;

comment on function public.get_public_products(text) is
  '공개 판매 화면에 필요한 판매 중·품절 상품 DTO. 자료 파일 경로와 내부 결제 컬럼은 반환하지 않는다.';

revoke all on function public.get_public_products(text) from public;
grant execute on function public.get_public_products(text) to anon, authenticated;

create or replace function public.get_public_product_detail_items(
  target_slug text default null
)
returns table (
  product_slug text,
  item_id uuid,
  sort_order integer,
  title text,
  body text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    product.slug,
    item.id,
    item.sort_order,
    item.title,
    item.body
  from public.product_detail_items as item
  join public.products as product on product.id = item.product_id
  where product.status in ('active', 'sold_out')
    and (
      target_slug is null
      or product.slug = target_slug
    )
  order by product.slug, item.sort_order, item.created_at;
$$;

comment on function public.get_public_product_detail_items(text) is
  '판매 중·품절 상품의 상세 항목. 목록과 상세 화면이 함께 쓴다.';

revoke all on function public.get_public_product_detail_items(text) from public;
grant execute on function public.get_public_product_detail_items(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 내 보유 목록
-- 자료가 붙어 있는지 알아야 마이 클래스가 "준비 중"과 "내려받기"를 가른다.
-- 경로 자체는 여기서도 내주지 않는다.
-- ---------------------------------------------------------------------------

drop function if exists public.get_my_active_product_library();
create or replace function public.get_my_active_product_library()
returns table (
  product_slug text,
  product_type text,
  title text,
  summary text,
  access_period_days integer,
  detail_path text,
  has_file boolean,
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
    product.file_path is not null,
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
