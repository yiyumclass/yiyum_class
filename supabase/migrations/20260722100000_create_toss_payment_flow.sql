-- Toss Payments 결제 요청과 승인 완료를 기존 orders/product_entitlements 구조에 연결한다.
-- 가격과 사용자 식별은 항상 DB 및 auth.uid()에서 가져오며, 클라이언트 입력을 신뢰하지 않는다.

create unique index if not exists orders_payment_key_unique_idx
  on public.orders (payment_key)
  where payment_key is not null;

-- 결제 요청 전에 서버가 호출한다. 활성 상품의 현재 가격을 주문 원장에 고정한다.
create or replace function public.create_toss_payment_order(target_product_slug text)
returns table (
  order_uid text,
  amount integer,
  order_name text,
  product_slug text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_product public.products%rowtype;
  generated_order_uid text;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into target_product
  from public.products
  where slug = target_product_slug
    and status = 'active';

  if not found then
    raise exception 'active product not found' using errcode = 'P0002';
  end if;

  if target_product.price_krw <= 0 then
    raise exception 'paid product required' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.product_entitlements as entitlement
    where entitlement.user_id = actor_id
      and entitlement.product_id = target_product.id
      and entitlement.status = 'active'
      and (entitlement.expires_at is null or entitlement.expires_at > now())
  ) then
    raise exception 'active entitlement already exists' using errcode = '23505';
  end if;

  generated_order_uid := public.generate_order_uid();

  insert into public.orders (
    user_id,
    product_id,
    order_uid,
    amount,
    source,
    status
  )
  values (
    actor_id,
    target_product.id,
    generated_order_uid,
    target_product.price_krw,
    'payment',
    'pending'
  );

  return query
  select
    generated_order_uid,
    target_product.price_krw,
    target_product.title,
    target_product.slug;
end;
$$;

comment on function public.create_toss_payment_order(text) is
  '로그인 사용자의 유료 상품 결제 요청을 pending 주문으로 생성하고 DB에서 확정한 주문번호와 금액을 반환한다.';

revoke all on function public.create_toss_payment_order(text) from public;
grant execute on function public.create_toss_payment_order(text) to authenticated;

-- Toss 승인 API에서 DONE 응답을 검증한 뒤 서버가 호출한다.
-- 주문 완료와 이용권 발급을 한 트랜잭션에서 처리하며 같은 paymentKey 재호출은 멱등하다.
create or replace function public.complete_toss_payment(
  target_order_uid text,
  target_payment_key text,
  target_amount integer,
  target_approved_at timestamptz
)
returns table (
  product_slug text,
  product_type text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_order public.orders%rowtype;
  target_product public.products%rowtype;
  entitlement_expires_at timestamptz;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if target_payment_key is null
    or char_length(target_payment_key) < 1
    or char_length(target_payment_key) > 200 then
    raise exception 'invalid payment key' using errcode = '22023';
  end if;

  select * into target_order
  from public.orders
  where order_uid = target_order_uid
  for update;

  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  if target_order.user_id <> actor_id then
    raise exception 'order permission denied' using errcode = '42501';
  end if;

  if target_order.source <> 'payment' or target_order.amount <> target_amount then
    raise exception 'order verification failed' using errcode = '22023';
  end if;

  select * into target_product
  from public.products
  where id = target_order.product_id;

  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  if target_order.status = 'paid' then
    if target_order.payment_key is distinct from target_payment_key then
      raise exception 'order already paid with another payment' using errcode = '23505';
    end if;

    return query
    select
      target_product.slug,
      target_product.product_type,
      entitlement.expires_at
    from public.product_entitlements as entitlement
    where entitlement.user_id = actor_id
      and entitlement.product_id = target_product.id;
    return;
  end if;

  if target_order.status <> 'pending' then
    raise exception 'order is not pending' using errcode = '55000';
  end if;

  entitlement_expires_at := case
    when target_product.access_period_days is null then null
    else coalesce(target_approved_at, now())
      + make_interval(days => target_product.access_period_days)
  end;

  update public.orders
  set
    status = 'paid',
    payment_key = target_payment_key,
    approved_at = coalesce(target_approved_at, now()),
    updated_at = now()
  where id = target_order.id;

  insert into public.product_entitlements (
    user_id,
    product_id,
    source,
    status,
    granted_at,
    expires_at,
    updated_at
  )
  values (
    actor_id,
    target_product.id,
    'payment',
    'active',
    coalesce(target_approved_at, now()),
    entitlement_expires_at,
    now()
  )
  on conflict (user_id, product_id) do update
  set
    source = 'payment',
    status = 'active',
    granted_at = excluded.granted_at,
    expires_at = excluded.expires_at,
    updated_at = now();

  return query
  select
    target_product.slug,
    target_product.product_type,
    entitlement_expires_at;
end;
$$;

comment on function public.complete_toss_payment(text, text, integer, timestamptz) is
  '검증된 Toss 결제를 paid로 확정하고 상품 이용권을 원자적으로 발급한다. 같은 주문과 paymentKey 재호출은 멱등하다.';

revoke all on function public.complete_toss_payment(text, text, integer, timestamptz) from public;
grant execute on function public.complete_toss_payment(text, text, integer, timestamptz) to authenticated;

-- 결제창에서 인증이 실패하거나 사용자가 취소한 pending 주문을 정리한다.
create or replace function public.fail_toss_payment_order(target_order_uid text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  changed_rows integer;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  update public.orders
  set status = 'failed', updated_at = now()
  where order_uid = target_order_uid
    and user_id = actor_id
    and source = 'payment'
    and status = 'pending';

  get diagnostics changed_rows = row_count;
  return changed_rows > 0;
end;
$$;

comment on function public.fail_toss_payment_order(text) is
  '로그인 사용자가 소유한 pending Toss 주문을 failed로 전환한다.';

revoke all on function public.fail_toss_payment_order(text) from public;
grant execute on function public.fail_toss_payment_order(text) to authenticated;

-- 초기 카탈로그의 정상 판매가를 복구한다. 다른 무료 상품은 그대로 유지한다.
update public.products
set price_krw = 300000
where slug = 'sns-monetization'
  and price_krw = 0;
