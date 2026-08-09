-- 무료 자료의 목적은 회원 확보다. 파일을 통째로 내주면 링크 하나로 끝나고,
-- 통째로 잠그면 무엇을 주는지 모르는 채 가입을 요구하게 된다. 앞부분만 열고
-- 나머지는 잠근다.
--
-- 잠근 페이지는 화면에서 가리는 것이 아니라 서버가 경로 자체를 내주지 않는다.
-- 가려두기만 하면 개발자 도구로 걷어낼 수 있다.

alter table public.products
  add column if not exists preview_page_count integer not null default 0
    check (preview_page_count >= 0);

comment on column public.products.preview_page_count is
  '로그인하지 않아도 볼 수 있는 앞쪽 페이지 수. 0이면 미리보기 없이 전부 잠긴다.';

create table if not exists public.product_pages (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null
    references public.products (id) on delete cascade,
  page_number integer not null check (page_number >= 1),
  image_path text not null,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  created_at timestamptz not null default now(),
  unique (product_id, page_number)
);

comment on table public.product_pages is
  '자료 PDF를 페이지별 이미지로 변환해 둔 것. 상세 화면의 뷰어가 쓴다.';
comment on column public.product_pages.image_path is
  'product-files 비공개 버킷 내부 경로만 저장한다. 공개 URL은 저장하지 않는다.';

create index if not exists product_pages_product_number_idx
  on public.product_pages (product_id, page_number);

alter table public.product_pages enable row level security;

revoke all on table public.product_pages from anon, authenticated;
grant select, insert, update, delete on table public.product_pages to authenticated;

drop policy if exists "Admins can manage product pages" on public.product_pages;
create policy "Admins can manage product pages"
  on public.product_pages
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 열람 판정
-- ---------------------------------------------------------------------------

create or replace function public.can_read_product_page(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.product_pages as page
    join public.products as product on product.id = page.product_id
    where page.image_path = object_name
      and product.status in ('active', 'sold_out')
      and (
        -- 미리보기 구간은 누구에게나 열린다
        page.page_number <= product.preview_page_count
        or public.is_admin()
        or exists (
          select 1
          from public.product_entitlements as entitlement
          where entitlement.product_id = product.id
            and entitlement.user_id = (select auth.uid())
            and entitlement.status = 'active'
            and (entitlement.expires_at is null or entitlement.expires_at > now())
        )
      )
  );
$$;

comment on function public.can_read_product_page(text) is
  '미리보기 구간이거나 이용권을 가진 회원인지 판정한다.';

revoke all on function public.can_read_product_page(text) from public;
grant execute on function public.can_read_product_page(text) to anon, authenticated;

drop policy if exists "Readers can view allowed product pages" on storage.objects;
create policy "Readers can view allowed product pages"
  on storage.objects
  for select
  to anon, authenticated
  using (
    bucket_id = 'product-files'
    and public.can_read_product_page(name)
  );

-- ---------------------------------------------------------------------------
-- 뷰어용 DTO
-- 잠긴 페이지는 경로 없이 번호만 알려준다. 몇 장이 더 있는지는 보여줘야
-- 가입할 이유가 생기고, 경로가 없으니 걷어낼 것도 없다.
-- ---------------------------------------------------------------------------

create or replace function public.get_product_pages(target_slug text)
returns table (
  page_number integer,
  image_path text,
  width integer,
  height integer,
  unlocked boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select
      product.id,
      product.preview_page_count,
      (
        public.is_admin()
        or exists (
          select 1
          from public.product_entitlements as entitlement
          where entitlement.product_id = product.id
            and entitlement.user_id = (select auth.uid())
            and entitlement.status = 'active'
            and (entitlement.expires_at is null or entitlement.expires_at > now())
        )
      ) as entitled
    from public.products as product
    where product.slug = target_slug
      and product.status in ('active', 'sold_out')
  )
  select
    page.page_number,
    case
      when viewer.entitled or page.page_number <= viewer.preview_page_count
        then page.image_path
      else null
    end,
    page.width,
    page.height,
    viewer.entitled or page.page_number <= viewer.preview_page_count
  from public.product_pages as page
  join viewer on viewer.id = page.product_id
  order by page.page_number;
$$;

comment on function public.get_product_pages(text) is
  '자료 뷰어가 쓰는 페이지 목록. 잠긴 페이지는 경로를 내리지 않고 번호만 알려준다.';

revoke all on function public.get_product_pages(text) from public;
grant execute on function public.get_product_pages(text) to anon, authenticated;
