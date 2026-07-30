-- Toss 콘솔에서 수동 부분취소가 일어나면 웹훅이 payment_refunds에 status='failed',
-- error_code='PARTIAL_CANCELLATION_UNSUPPORTED'로 기록만 남긴다(앱은 전액 환불만
-- 자동 처리한다). 그런데 회원 원장은 최신 환불 1건을 그대로 반환하므로, 마이페이지에
-- 주문은 "결제 완료"인데 환불 금액만 덩그러니 붙는 상태가 됐다.
--
-- 반환 컬럼은 그대로 두고 값만 'partial_review'로 구분한다. 컬럼을 추가하면
-- 반환 타입이 바뀌어 create or replace가 막힌다.

create or replace function public.get_my_order_ledger()
returns table (
  transaction_id uuid,
  order_uid text,
  product_slug text,
  product_title text,
  product_type text,
  amount_krw integer,
  source text,
  payment_status text,
  entitlement_status text,
  ordered_at timestamptz,
  approved_at timestamptz,
  refunded_at timestamptz,
  expires_at timestamptz,
  refund_status text,
  refund_amount_krw integer,
  refund_policy_agreed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    orders.id,
    orders.order_uid,
    product.slug,
    product.title,
    product.product_type,
    orders.amount,
    orders.source,
    orders.status,
    case
      when entitlement.id is null then 'none'
      when entitlement.status = 'revoked' then 'revoked'
      when entitlement.expires_at is not null
        and entitlement.expires_at <= now() then 'expired'
      else 'active'
    end,
    orders.created_at,
    orders.approved_at,
    case when orders.status = 'refunded' then orders.canceled_at else null end,
    entitlement.expires_at,
    case
      when latest_refund.error_code = 'PARTIAL_CANCELLATION_UNSUPPORTED'
        then 'partial_review'
      else latest_refund.status
    end,
    latest_refund.amount,
    orders.refund_policy_agreed_at
  from public.orders as orders
  join public.products as product
    on product.id = orders.product_id
  left join public.product_entitlements as entitlement
    on entitlement.user_id = orders.user_id
   and entitlement.product_id = orders.product_id
  left join lateral (
    select refund.status, refund.amount, refund.error_code
    from public.payment_refunds as refund
    where refund.order_id = orders.id
    order by refund.requested_at desc
    limit 1
  ) as latest_refund on true
  where orders.user_id = (select auth.uid())
  order by orders.created_at desc;
$$;

comment on function public.get_my_order_ledger() is
  '로그인 회원 본인의 주문 원장과 현재 이용권·환불 상태를 반환한다. 결제키 및 운영 정보는 노출하지 않는다.';

revoke all on function public.get_my_order_ledger() from public, anon;
grant execute on function public.get_my_order_ledger() to authenticated;
