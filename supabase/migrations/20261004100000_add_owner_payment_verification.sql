alter table public.products
  add constraint products_payment_verification_restricted
  check (
    slug <> 'admin-payment-verification-100'
    or (
      price_krw = 100
      and product_type = 'course'
      and status in ('draft', 'archived')
      and access_period_days is not null
      and access_period_days = 1
    )
  );

insert into public.products (
  slug, product_type, title, summary, price_krw, status, access_period_days
)
values (
  'admin-payment-verification-100', 'course', '관리자 결제 검증 · 100원',
  '결제 승인·이용권 발급·전액 취소를 확인하는 관리자 전용 상품입니다.',
  100, 'draft', 1
);

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

  if target_product_slug = 'admin-payment-verification-100'
    and not public.is_admin(array['owner']::text[]) then
    raise exception 'owner role required' using errcode = '42501';
  end if;

  select * into target_product
  from public.products
  where slug = target_product_slug
    and (
      (slug <> 'admin-payment-verification-100' and status = 'active')
      or (
        slug = 'admin-payment-verification-100'
        and status = 'draft'
        and price_krw = 100
        and product_type = 'course'
      )
    );

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
    user_id, product_id, order_uid, amount, source, status
  )
  values (
    actor_id, target_product.id, generated_order_uid,
    target_product.price_krw, 'payment', 'pending'
  );

  return query
  select
    generated_order_uid,
    target_product.price_krw,
    target_product.title,
    target_product.slug;
end;
$$;

revoke all on function public.create_toss_payment_order(text) from public, anon;
grant execute on function public.create_toss_payment_order(text) to authenticated;
