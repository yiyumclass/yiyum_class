-- 무료 자료는 내려받게 하지 않고 사이트에서만 읽게 한다. 그러면 "받기"라는
-- 행동이 없어지므로 이용권을 발급할 자리도 사라진다. 무료 자료의 잠금은
-- 로그인 여부로 판정한다. 목적은 회원 확보이고, 로그인은 그 목적을 이미 만족한다.
--
-- 유료 상품은 그대로 이용권을 요구한다. 돈을 낸 사람만 봐야 하기 때문이다.

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
        -- 무료 자료는 로그인한 회원 모두에게 열린다
        or (product.price_krw = 0 and (select auth.uid()) is not null)
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
  '미리보기 구간이거나, 로그인한 회원이 보는 무료 자료이거나, 이용권을 가진 회원인지 판정한다.';

revoke all on function public.can_read_product_page(text) from public;
grant execute on function public.can_read_product_page(text) to anon, authenticated;

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
        or (product.price_krw = 0 and (select auth.uid()) is not null)
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
