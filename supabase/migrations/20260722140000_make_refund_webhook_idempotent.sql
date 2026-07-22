-- Make repeated CANCELED webhooks reuse an already-succeeded refund row.

-- The original function only reused open rows, so a webhook delivered after the admin

-- action could collide with the one-successful-refund-per-order index.

create or replace function public.complete_toss_refund_server(
  target_order_uid text,
  target_payment_key text,
  target_amount integer,
  target_canceled_at timestamptz,
  target_transaction_key text,
  target_refund_uid text,
  target_actor_user_id uuid,
  target_reason text
)
returns table (
  product_slug text,
  refund_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_order public.orders%rowtype;
  target_product public.products%rowtype;
  existing_refund public.payment_refunds%rowtype;
  resolved_refund_uid text;
  resolved_reason text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select * into target_order
  from public.orders
  where order_uid = target_order_uid
  for update;

  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if target_order.source <> 'payment'
    or target_order.payment_key is distinct from target_payment_key
    or target_order.amount <> target_amount then
    raise exception 'refund verification failed' using errcode = '22023';
  end if;
  if target_order.status not in ('paid', 'refunded') then
    raise exception 'paid order required' using errcode = '55000';
  end if;

  select * into target_product
  from public.products
  where id = target_order.product_id;

  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  if nullif(target_refund_uid, '') is null then
    select * into existing_refund
    from public.payment_refunds
    where order_id = target_order.id
      and status in ('requested', 'processing', 'succeeded')
    order by requested_at desc
    limit 1
    for update;
  end if;

  resolved_refund_uid := coalesce(
    nullif(target_refund_uid, ''),
    existing_refund.refund_uid,
    'toss-' || substr(md5(target_payment_key || ':' || target_order_uid), 1, 24)
  );
  resolved_reason := left(
    coalesce(
      nullif(btrim(target_reason), ''),
      existing_refund.reason,
      'Toss 결제 취소 웹훅 동기화'
    ),
    200
  );

  update public.orders
  set
    status = 'refunded',
    canceled_at = coalesce(target_canceled_at, canceled_at, now()),
    updated_at = now()
  where id = target_order.id;

  -- 결제로 발급된 이용권만 회수한다. 결제 후 별도로 관리자 지급으로 전환된
  -- 이용권까지 환불 때문에 제거하지 않는다.
  update public.product_entitlements
  set status = 'revoked', updated_at = now()
  where user_id = target_order.user_id
    and product_id = target_order.product_id
    and source = 'payment';

  insert into public.payment_refunds (
    order_id,
    refund_uid,
    amount,
    reason,
    status,
    requested_by,
    idempotency_key,
    toss_transaction_key,
    toss_cancel_status,
    completed_at
  )
  values (
    target_order.id,
    resolved_refund_uid,
    target_order.amount,
    resolved_reason,
    'succeeded',
    target_actor_user_id,
    'reconcile-' || resolved_refund_uid,
    nullif(target_transaction_key, ''),
    'DONE',
    coalesce(target_canceled_at, now())
  )
  on conflict (refund_uid) do update
  set
    status = 'succeeded',
    toss_transaction_key = coalesce(
      excluded.toss_transaction_key,
      public.payment_refunds.toss_transaction_key
    ),
    toss_cancel_status = 'DONE',
    error_code = null,
    error_message = null,
    completed_at = coalesce(excluded.completed_at, now()),
    updated_at = now();

  if target_order.status <> 'refunded' then
    insert into public.admin_audit_logs (
      actor_user_id,
      action,
      target_type,
      target_id,
      metadata
    )
    values (
      target_actor_user_id,
      'payment.refunded',
      'order',
      target_order.id::text,
      jsonb_build_object(
        'order_uid', target_order.order_uid,
        'product_slug', target_product.slug,
        'amount', target_order.amount,
        'refund_uid', resolved_refund_uid,
        'transaction_key', target_transaction_key
      )
    );
  end if;

  return query select target_product.slug, 'succeeded'::text;
end;
$$;

revoke all on function public.complete_toss_refund_server(text, text, integer, timestamptz, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_toss_refund_server(text, text, integer, timestamptz, text, text, uuid, text) to service_role;
