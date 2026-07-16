create or replace function public.get_admin_order_ledger()
returns table (
  transaction_id uuid,
  customer_id uuid,
  customer_name text,
  customer_email text,
  product_id uuid,
  product_title text,
  product_type text,
  source text,
  entitlement_status text,
  amount_krw integer,
  created_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    entitlement.id,
    entitlement.user_id,
    coalesce(
      nullif(account.raw_user_meta_data ->> 'nickname', ''),
      nullif(account.raw_user_meta_data ->> 'name', ''),
      nullif(split_part(coalesce(account.email, ''), '@', 1), ''),
      '이름 미등록'
    ),
    coalesce(account.email, '이메일 정보 없음'),
    product.id,
    product.title,
    product.product_type,
    entitlement.source,
    entitlement.status,
    case
      when entitlement.source in ('free_checkout', 'admin_grant') then 0
      else null
    end,
    entitlement.granted_at,
    entitlement.expires_at
  from public.product_entitlements as entitlement
  join public.products as product on product.id = entitlement.product_id
  join auth.users as account on account.id = entitlement.user_id
  where public.is_admin()
  order by entitlement.granted_at desc;
$$;

comment on function public.get_admin_order_ledger() is
  '관리자 주문·결제 화면에서 현재 무료 신청과 이용권 발급 내역을 조회한다. 결제 금액은 실제 주문 테이블 도입 전까지 null로 반환한다.';

revoke all on function public.get_admin_order_ledger() from public;
grant execute on function public.get_admin_order_ledger() to authenticated;
