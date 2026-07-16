-- 주문 원장(orders)을 정식 테이블로 분리한다.
-- 지금까지 주문 원장은 product_entitlements(회원·상품당 1행, 현재 상태 스냅샷)를
-- 주문처럼 재해석해 왔다. 이 마이그레이션은 무료 신청·관리자 지급을 append-only로
-- 쌓는 별도의 orders 테이블을 만들고, 발급 함수들이 이용권과 함께 주문 행을 기록하게 한다.
--
-- 기존 마이그레이션 본문은 수정하지 않고, 여기서 create table if not exists /
-- create or replace로 재정의한다. 재정의 대상은 20260716110000의 유효 버전을 기준으로 한다.
-- 결제 승인·취소·환불(pending→paid 전이) 자체는 이번 범위 밖이며, 컬럼만 준비한다.

-- 1. orders 테이블 --------------------------------------------------------------

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id),
  order_uid text not null unique,
  amount integer not null,
  source text not null
    check (source in ('free_checkout', 'payment', 'admin_grant')),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'canceled', 'refunded', 'failed')),
  payment_key text,
  approved_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.orders is
  '주문 원장. 무료 신청·관리자 지급·결제를 시점 확정 금액과 함께 append-only로 기록한다. 이용권과 달리 회원·상품당 여러 행이 쌓인다.';
comment on column public.orders.order_uid is
  '토스 orderId로 넘길 주문번호. 영숫자와 -,_ 만 사용하고 6~64자, unique.';
comment on column public.orders.amount is
  '주문 시점에 확정한 금액(원). 이후 상품 가격이 바뀌어도 보존한다.';

create index if not exists orders_user_id_idx
  on public.orders (user_id);
create index if not exists orders_product_id_idx
  on public.orders (product_id);
create index if not exists orders_status_idx
  on public.orders (status);
create index if not exists orders_created_at_idx
  on public.orders (created_at desc);

-- 20260716110000에서 만든 공용 트리거 함수를 재사용한다.
drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

alter table public.orders enable row level security;
revoke all on table public.orders from anon, authenticated;
grant select on table public.orders to authenticated;

-- 회원은 본인 주문만 조회한다. 쓰기는 보안 정의자 함수를 통해서만 이뤄진다.
drop policy if exists "Members can view own orders" on public.orders;
create policy "Members can view own orders"
  on public.orders
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- 2. 주문번호 생성 헬퍼 ---------------------------------------------------------

-- 'ORD-YYYYMMDD-<uuid 32자리>' 형태. 45자로 토스 제약(6~64자, 영숫자·-·_)을 만족하고
-- gen_random_uuid로 unique를 보장한다. 보안 정의자 함수 내부에서만 호출한다.
create or replace function public.generate_order_uid()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'ORD-' || to_char(now(), 'YYYYMMDD') || '-'
    || replace(gen_random_uuid()::text, '-', '');
$$;

comment on function public.generate_order_uid() is
  '토스 orderId 제약을 만족하는 unique 주문번호를 생성한다.';

revoke all on function public.generate_order_uid() from public;
grant execute on function public.generate_order_uid() to authenticated;

-- 3. claim_free_product 재정의 (20260716110000 기준 + 주문 append) ----------------

-- 0원 상품 즉시 신청. 이용권 upsert 동작(granted_at 보존, 반환 shape)은 그대로 두고,
-- 신청마다 public.orders에 주문 행을 새로 쌓는다(append-only 원장).
create or replace function public.claim_free_product(target_product_slug text)
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
  target_product public.products%rowtype;
  entitlement_expires_at timestamptz;
begin
  if actor_id is null then
    raise exception 'authentication required';
  end if;

  select * into target_product
  from public.products
  where slug = target_product_slug
    and status = 'active';

  if not found then
    raise exception 'active product not found';
  end if;
  if target_product.price_krw <> 0 then
    raise exception 'product is not free';
  end if;

  entitlement_expires_at := case
    when target_product.access_period_days is null then null
    else now() + make_interval(days => target_product.access_period_days)
  end;

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
    'free_checkout',
    'active',
    now(),
    entitlement_expires_at,
    now()
  )
  on conflict (user_id, product_id) do update
  set
    source = 'free_checkout',
    status = 'active',
    -- granted_at은 갱신하지 않는다: 재신청 시 최초 발급 시각을 보존한다.
    expires_at = excluded.expires_at,
    updated_at = now();

  -- 무료 재신청 시에도 주문은 매번 새 행으로 쌓인다(append-only 원장).
  insert into public.orders (
    user_id,
    product_id,
    order_uid,
    amount,
    source,
    status,
    approved_at
  )
  values (
    actor_id,
    target_product.id,
    public.generate_order_uid(),
    target_product.price_krw,
    'free_checkout',
    'paid',
    now()
  );

  return query
  select
    target_product.slug,
    target_product.product_type,
    entitlement_expires_at;
end;
$$;

comment on function public.claim_free_product(text) is
  '로그인 사용자가 판매 중인 0원 상품을 즉시 신청하고 이용권을 발급받으며 주문 원장에 기록한다. 재신청 시 최초 발급 시각을 보존한다.';

revoke all on function public.claim_free_product(text) from public;
grant execute on function public.claim_free_product(text) to authenticated;

-- 4. admin_grant_product_entitlement 재정의 (20260716110000 기준 + 주문 append) ----

-- 관리자(owner) 수강권 지급. 이용권 upsert·감사 로그·반환 shape는 그대로 두고,
-- 지급마다 public.orders에 주문 행을 새로 쌓는다.
create or replace function public.admin_grant_product_entitlement(
  target_user_id uuid,
  target_product_id uuid,
  target_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_product public.products%rowtype;
  target_email text;
  result_id uuid;
begin
  if not public.is_admin(array['owner']::text[]) then
    raise exception 'admin permission required' using errcode = '42501';
  end if;

  select email into target_email
  from auth.users
  where id = target_user_id
    and deleted_at is null;

  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;

  select * into target_product
  from public.products
  where id = target_product_id
    and status <> 'archived';

  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  if target_expires_at is not null and target_expires_at <= now() then
    raise exception 'expiration must be in the future' using errcode = '22007';
  end if;

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
    target_product_id,
    'admin_grant',
    'active',
    now(),
    target_expires_at,
    now()
  )
  on conflict (user_id, product_id) do update
  set
    source = 'admin_grant',
    status = 'active',
    -- granted_at은 갱신하지 않는다: 재지급 시 최초 발급 시각을 보존한다.
    expires_at = excluded.expires_at,
    updated_at = now()
  returning id into result_id;

  insert into public.admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    actor_id,
    'entitlement.granted',
    'product_entitlements',
    result_id::text,
    jsonb_build_object(
      'member_id', target_user_id,
      'member_email', target_email,
      'product_id', target_product_id,
      'product_title', target_product.title,
      'status', 'active',
      'expires_at', target_expires_at
    )
  );

  -- 재지급 시에도 주문은 매번 새 행으로 쌓인다(append-only 원장).
  insert into public.orders (
    user_id,
    product_id,
    order_uid,
    amount,
    source,
    status,
    approved_at
  )
  values (
    target_user_id,
    target_product_id,
    public.generate_order_uid(),
    target_product.price_krw,
    'admin_grant',
    'paid',
    now()
  );

  return result_id;
end;
$$;

comment on function public.admin_grant_product_entitlement(uuid, uuid, timestamptz) is
  'owner가 회원에게 상품 수강권을 지급하거나 재활성화하고 주문 원장에 기록한다. 재지급 시 최초 발급 시각을 보존한다.';

revoke all on function public.admin_grant_product_entitlement(uuid, uuid, timestamptz) from public;
grant execute on function public.admin_grant_product_entitlement(uuid, uuid, timestamptz) to authenticated;

-- 5. get_admin_order_ledger 재정의 (product_entitlements → orders) ---------------

-- 이제 원장은 orders에서 조회한다. 반환 컬럼 계약(src/lib/admin/orders.ts)은 그대로 유지한다.
--   - transaction_id: 주문 id (한 회원·상품에 여러 주문이 정상)
--   - amount_krw: 주문 시점 확정 금액(orders.amount, not null)
--   - entitlement_status: 주문 상태를 UI 계약(active/revoked)에 맞춰 파생한다.
--       paid → active(이용 가능), 그 외(canceled/refunded/failed/pending) → revoked
--   - expires_at: 해당 회원·상품의 현재 이용권 만료일(있으면)
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
    orders.id,
    orders.user_id,
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
    orders.source,
    case when orders.status = 'paid' then 'active' else 'revoked' end,
    orders.amount,
    orders.created_at,
    entitlement.expires_at
  from public.orders as orders
  join public.products as product on product.id = orders.product_id
  join auth.users as account on account.id = orders.user_id
  left join public.product_entitlements as entitlement
    on entitlement.user_id = orders.user_id
   and entitlement.product_id = orders.product_id
  where public.is_admin()
  order by orders.created_at desc;
$$;

comment on function public.get_admin_order_ledger() is
  '관리자 주문·결제 화면에서 orders 원장을 조회한다. 무료 신청·관리자 지급이 append-only로 쌓이며 실제 확정 금액을 반환한다.';

revoke all on function public.get_admin_order_ledger() from public;
grant execute on function public.get_admin_order_ledger() to authenticated;

-- 6. 기존 이용권 backfill -------------------------------------------------------

-- 현재 product_entitlements의 모든 행을 orders로 1회 이관한다.
-- 재적용 안전을 위해 이미 같은 회원·상품 주문이 있으면 건너뛴다(마이그레이션 최초 적용 시 orders는 비어 있다).
--   source: product_entitlements와 orders의 source 어휘가 동일하므로 그대로 옮긴다
--   status: active → paid, 그 외(revoked 등) → canceled
--   created_at/approved_at: entitlement.granted_at, canceled 행은 canceled_at도 채운다
insert into public.orders (
  user_id,
  product_id,
  order_uid,
  amount,
  source,
  status,
  approved_at,
  canceled_at,
  created_at,
  updated_at
)
select
  entitlement.user_id,
  entitlement.product_id,
  public.generate_order_uid(),
  coalesce(product.price_krw, 0),
  entitlement.source,
  case when entitlement.status = 'active' then 'paid' else 'canceled' end,
  entitlement.granted_at,
  case when entitlement.status = 'active' then null else entitlement.granted_at end,
  entitlement.granted_at,
  entitlement.granted_at
from public.product_entitlements as entitlement
join public.products as product on product.id = entitlement.product_id
where not exists (
  select 1
  from public.orders as existing
  where existing.user_id = entitlement.user_id
    and existing.product_id = entitlement.product_id
);
