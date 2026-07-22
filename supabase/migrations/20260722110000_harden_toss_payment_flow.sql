-- Toss 승인 완료 함수는 결제사 검증을 수행한 서버만 호출할 수 있어야 한다.
-- 최초 함수의 authenticated 실행 권한을 제거하고 service_role 전용 함수로 교체한다.

revoke all on function public.complete_toss_payment(text, text, integer, timestamptz)
  from public, anon, authenticated;

-- 기존 중복 pending 주문이 있다면 가장 최근 주문만 남긴 뒤 부분 unique index를 추가한다.
with ranked_pending as (
  select
    id,
    row_number() over (
      partition by user_id, product_id
      order by created_at desc, id desc
    ) as pending_rank
  from public.orders
  where source = 'payment'
    and status = 'pending'
)
update public.orders as orders
set status = 'failed', updated_at = now()
from ranked_pending
where orders.id = ranked_pending.id
  and ranked_pending.pending_rank > 1;

create unique index if not exists orders_one_pending_payment_per_product_idx
  on public.orders (user_id, product_id)
  where source = 'payment' and status = 'pending';

-- 같은 사용자·상품 요청을 트랜잭션 advisory lock으로 직렬화하고,
-- 30분 이내 pending 주문은 새로 만들지 않고 재사용한다.
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
  existing_order public.orders%rowtype;
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':' || target_product.id::text, 0)
  );

  update public.orders
  set status = 'failed', updated_at = now()
  where user_id = actor_id
    and product_id = target_product.id
    and source = 'payment'
    and status = 'pending'
    and created_at < now() - interval '30 minutes';

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

  select * into existing_order
  from public.orders
  where user_id = actor_id
    and product_id = target_product.id
    and source = 'payment'
    and status = 'pending'
  order by created_at desc
  limit 1
  for update;

  if found then
    return query
    select
      existing_order.order_uid,
      existing_order.amount,
      target_product.title,
      target_product.slug;
    return;
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

revoke all on function public.create_toss_payment_order(text) from public;
grant execute on function public.create_toss_payment_order(text) to authenticated;

create or replace function public.complete_toss_payment_server(
  target_user_id uuid,
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
  target_order public.orders%rowtype;
  target_product public.products%rowtype;
  entitlement_expires_at timestamptz;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if target_user_id is null then
    raise exception 'target user required' using errcode = '22023';
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

  if target_order.user_id <> target_user_id then
    raise exception 'order owner mismatch' using errcode = '42501';
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

  entitlement_expires_at := case
    when target_product.access_period_days is null then null
    else coalesce(target_order.approved_at, target_approved_at, now())
      + make_interval(days => target_product.access_period_days)
  end;

  if target_order.status = 'paid' then
    if target_order.payment_key is distinct from target_payment_key then
      raise exception 'order already paid with another payment' using errcode = '23505';
    end if;

    -- paid 주문과 이용권 사이에 비정상 누락이 있을 때만 복구한다.
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
      target_user_id,
      target_product.id,
      'payment',
      'active',
      coalesce(target_order.approved_at, target_approved_at, now()),
      entitlement_expires_at,
      now()
    )
    on conflict (user_id, product_id) do nothing;

    return query
    select
      target_product.slug,
      target_product.product_type,
      entitlement.expires_at
    from public.product_entitlements as entitlement
    where entitlement.user_id = target_user_id
      and entitlement.product_id = target_product.id;
    return;
  end if;

  if target_order.status <> 'pending'
    and not (
      target_order.status = 'failed'
      and target_order.payment_key = target_payment_key
    ) then
    raise exception 'order is not pending' using errcode = '55000';
  end if;

  if target_order.payment_key is not null
    and target_order.payment_key <> target_payment_key then
    raise exception 'payment key mismatch' using errcode = '23505';
  end if;

  update public.orders
  set
    status = 'paid',
    payment_key = target_payment_key,
    approved_at = coalesce(target_approved_at, approved_at, now()),
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
    target_user_id,
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

comment on function public.complete_toss_payment_server(uuid, text, text, integer, timestamptz) is
  'service_role 전용. Toss API에서 검증된 결제를 paid로 확정하고 상품 이용권을 원자적으로 발급한다.';

revoke all on function public.complete_toss_payment_server(uuid, text, text, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_toss_payment_server(uuid, text, text, integer, timestamptz)
  to service_role;
