-- 회원 탈퇴는 즉시 Auth 계정을 삭제하되, 전자상거래법상 보관이 필요한
-- 주문·청약철회 기록만 운영 데이터와 분리해 제한적으로 보관한다.
--
-- 처리 순서:
--   1) prepare_my_account_withdrawal()이 동일 트랜잭션에서 법정 기록을 복제한다.
--   2) 애플리케이션 서버가 service_role로 auth.users를 hard delete한다.
--   3) 기존 ON DELETE CASCADE가 주문·수강권·학습·동의 데이터를 제거한다.
--   4) 매일 cron이 보관기한이 지난 분리 기록과 식별정보를 파기한다.

create table if not exists public.account_withdrawals (
  id uuid primary key default gen_random_uuid(),
  -- Auth 삭제 전 재시도 식별에만 사용한다. 완료 즉시 null로 바꾸며 FK를 두지 않는다.
  user_id uuid,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  customer_name text,
  customer_email text,
  requested_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  completed_at timestamptz,
  retention_until timestamptz,
  purged_at timestamptz,
  order_record_count integer not null default 0 check (order_record_count >= 0),
  refund_record_count integer not null default 0 check (refund_record_count >= 0),
  failure_code text,
  updated_at timestamptz not null default now()
);
create unique index if not exists account_withdrawals_active_user_idx
  on public.account_withdrawals (user_id)
  where user_id is not null;
create index if not exists account_withdrawals_requested_at_idx
  on public.account_withdrawals (requested_at desc);
create index if not exists account_withdrawals_retention_until_idx
  on public.account_withdrawals (retention_until)
  where retention_until is not null;
comment on table public.account_withdrawals is
  '탈퇴 처리 상태와 법정 보관 식별정보. 완료 후 user_id를 제거하고, 보관기한 종료 시 이름·이메일도 파기한다.';
create table if not exists public.account_withdrawal_order_records (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid not null references public.account_withdrawals(id) on delete cascade,
  original_order_id uuid not null unique,
  order_uid text not null,
  product_id uuid not null,
  product_slug text not null,
  product_title text not null,
  product_type text not null,
  amount integer not null,
  source text not null,
  status text not null,
  payment_key text,
  approved_at timestamptz,
  canceled_at timestamptz,
  refund_policy_version text,
  refund_policy_agreed_at timestamptz,
  ordered_at timestamptz not null,
  retain_until timestamptz not null,
  archived_at timestamptz not null default now()
);
create index if not exists account_withdrawal_orders_withdrawal_idx
  on public.account_withdrawal_order_records (withdrawal_id, ordered_at desc);
create index if not exists account_withdrawal_orders_retain_until_idx
  on public.account_withdrawal_order_records (retain_until);
comment on table public.account_withdrawal_order_records is
  '탈퇴 회원의 계약·결제·콘텐츠 공급 증빙 스냅샷. 원 운영 주문과 분리하여 5년 보관한다.';
create table if not exists public.account_withdrawal_refund_records (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid not null references public.account_withdrawals(id) on delete cascade,
  original_refund_id uuid not null unique,
  original_order_id uuid not null,
  refund_uid text not null,
  amount integer not null,
  reason text not null,
  status text not null,
  toss_transaction_key text,
  toss_cancel_status text,
  error_code text,
  requested_at timestamptz not null,
  completed_at timestamptz,
  retain_until timestamptz not null,
  archived_at timestamptz not null default now()
);
create index if not exists account_withdrawal_refunds_withdrawal_idx
  on public.account_withdrawal_refund_records (withdrawal_id, requested_at desc);
create index if not exists account_withdrawal_refunds_retain_until_idx
  on public.account_withdrawal_refund_records (retain_until);
comment on table public.account_withdrawal_refund_records is
  '탈퇴 회원의 청약철회·환불 증빙 스냅샷. 원 운영 환불 원장과 분리하여 5년 보관한다.';
alter table public.account_withdrawals enable row level security;
alter table public.account_withdrawal_order_records enable row level security;
alter table public.account_withdrawal_refund_records enable row level security;
-- 분리 보관 테이블은 브라우저에서 직접 조회하지 않는다. 본인 준비 RPC,
-- owner 조회 RPC, service_role 유지보수 RPC만 접근한다.
revoke all on table public.account_withdrawals from public, anon, authenticated;
revoke all on table public.account_withdrawal_order_records from public, anon, authenticated;
revoke all on table public.account_withdrawal_refund_records from public, anon, authenticated;
grant select, insert, update, delete on table public.account_withdrawals to service_role;
grant select, insert, update, delete on table public.account_withdrawal_order_records to service_role;
grant select, insert, update, delete on table public.account_withdrawal_refund_records to service_role;
-- auth.users 삭제가 orders를 지울 때 이미 별도 보관된 환불 원장도 함께 정리한다.
-- 기본 NO ACTION이면 환불이 있었던 회원의 Auth 삭제가 FK에서 막힌다.
alter table public.payment_refunds
  drop constraint if exists payment_refunds_order_id_fkey;
alter table public.payment_refunds
  add constraint payment_refunds_order_id_fkey
  foreign key (order_id) references public.orders(id) on delete cascade;
create or replace function public.prepare_my_account_withdrawal(
  confirmation_text text,
  acknowledged boolean
)
returns table (
  withdrawal_id uuid,
  order_record_count integer,
  refund_record_count integer,
  retention_until timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  account auth.users%rowtype;
  target_withdrawal_id uuid;
  archived_order_count integer := 0;
  archived_refund_count integer := 0;
  latest_retention timestamptz;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if acknowledged is not true or confirmation_text <> '회원탈퇴' then
    raise exception 'account withdrawal confirmation required' using errcode = '22023';
  end if;

  -- 같은 사용자의 중복 요청을 직렬화한다. 클라이언트가 버튼을 연속으로 눌러도
  -- 서로 다른 스냅샷/탈퇴 행을 만들지 않는다.
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));

  if exists (
    select 1
    from public.admin_users as admin_user
    where admin_user.user_id = actor_id
      and admin_user.is_active = true
  ) then
    raise exception 'active admin account cannot be withdrawn'
      using errcode = '42501';
  end if;

  -- 환불 API 호출이 진행 중일 때 원 주문을 지우면 외부 Toss 응답을 반영할 곳이
  -- 사라진다. 완료/실패가 확정된 뒤 다시 요청하도록 안전하게 막는다.
  if exists (
    select 1
    from public.payment_refunds as refund
    join public.orders as target_order on target_order.id = refund.order_id
    where target_order.user_id = actor_id
      and refund.status in ('requested', 'processing')
  ) then
    raise exception 'open refund must be completed before account withdrawal'
      using errcode = '55000';
  end if;

  select * into account
  from auth.users
  where id = actor_id
    and deleted_at is null;

  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;

  -- 주문을 잠가 준비 트랜잭션 중 결제·환불 상태가 바뀐 반쪽 스냅샷을 막는다.
  perform 1
  from public.orders
  where user_id = actor_id
  for update;

  insert into public.account_withdrawals (
    user_id,
    status,
    customer_name,
    customer_email,
    requested_at,
    last_attempt_at,
    completed_at,
    retention_until,
    purged_at,
    failure_code,
    updated_at
  )
  values (
    actor_id,
    'processing',
    nullif(btrim(coalesce(
      account.raw_user_meta_data ->> 'name',
      account.raw_user_meta_data ->> 'nickname',
      account.raw_user_meta_data ->> 'full_name',
      ''
    )), ''),
    nullif(btrim(coalesce(account.email, '')), ''),
    now(),
    now(),
    null,
    null,
    null,
    null,
    now()
  )
  on conflict (user_id) where user_id is not null
  do update set
    status = 'processing',
    customer_name = excluded.customer_name,
    customer_email = excluded.customer_email,
    last_attempt_at = now(),
    completed_at = null,
    retention_until = null,
    purged_at = null,
    failure_code = null,
    updated_at = now()
  returning id into target_withdrawal_id;

  -- 실패 후 재시도라면 과거 준비본을 지우고 현재 원장을 다시 원자적으로 복제한다.
  delete from public.account_withdrawal_refund_records as refund_record
  where refund_record.withdrawal_id = target_withdrawal_id;
  delete from public.account_withdrawal_order_records as order_record
  where order_record.withdrawal_id = target_withdrawal_id;

  insert into public.account_withdrawal_order_records (
    withdrawal_id,
    original_order_id,
    order_uid,
    product_id,
    product_slug,
    product_title,
    product_type,
    amount,
    source,
    status,
    payment_key,
    approved_at,
    canceled_at,
    refund_policy_version,
    refund_policy_agreed_at,
    ordered_at,
    retain_until
  )
  select
    target_withdrawal_id,
    target_order.id,
    target_order.order_uid,
    target_order.product_id,
    product.slug,
    product.title,
    product.product_type,
    target_order.amount,
    target_order.source,
    target_order.status,
    target_order.payment_key,
    target_order.approved_at,
    target_order.canceled_at,
    target_order.refund_policy_version,
    target_order.refund_policy_agreed_at,
    target_order.created_at,
    greatest(
      target_order.created_at,
      coalesce(target_order.approved_at, target_order.created_at),
      coalesce(target_order.canceled_at, target_order.created_at)
    ) + interval '5 years'
  from public.orders as target_order
  join public.products as product on product.id = target_order.product_id
  where target_order.user_id = actor_id
    and greatest(
      target_order.created_at,
      coalesce(target_order.approved_at, target_order.created_at),
      coalesce(target_order.canceled_at, target_order.created_at)
    ) + interval '5 years' > now();

  get diagnostics archived_order_count = row_count;

  insert into public.account_withdrawal_refund_records (
    withdrawal_id,
    original_refund_id,
    original_order_id,
    refund_uid,
    amount,
    reason,
    status,
    toss_transaction_key,
    toss_cancel_status,
    error_code,
    requested_at,
    completed_at,
    retain_until
  )
  select
    target_withdrawal_id,
    refund.id,
    refund.order_id,
    refund.refund_uid,
    refund.amount,
    refund.reason,
    refund.status,
    refund.toss_transaction_key,
    refund.toss_cancel_status,
    refund.error_code,
    refund.requested_at,
    refund.completed_at,
    greatest(
      refund.requested_at,
      coalesce(refund.completed_at, refund.requested_at)
    ) + interval '5 years'
  from public.payment_refunds as refund
  join public.orders as target_order on target_order.id = refund.order_id
  where target_order.user_id = actor_id
    and greatest(
      refund.requested_at,
      coalesce(refund.completed_at, refund.requested_at)
    ) + interval '5 years' > now();

  get diagnostics archived_refund_count = row_count;

  select max(record_retention) into latest_retention
  from (
    select retain_until as record_retention
    from public.account_withdrawal_order_records
    where account_withdrawal_order_records.withdrawal_id = target_withdrawal_id
    union all
    select retain_until
    from public.account_withdrawal_refund_records
    where account_withdrawal_refund_records.withdrawal_id = target_withdrawal_id
  ) as retained_records;

  update public.account_withdrawals
  set
    order_record_count = archived_order_count,
    refund_record_count = archived_refund_count,
    retention_until = latest_retention,
    -- 보관할 거래가 없으면 준비 단계에서도 불필요한 식별정보를 남기지 않는다.
    customer_name = case when latest_retention is null then null else customer_name end,
    customer_email = case when latest_retention is null then null else customer_email end,
    updated_at = now()
  where id = target_withdrawal_id;

  return query
  select
    target_withdrawal_id,
    archived_order_count,
    archived_refund_count,
    latest_retention;
end;
$$;
comment on function public.prepare_my_account_withdrawal(text, boolean) is
  '현재 로그인 회원의 주문·환불 법정 보관본을 원자적으로 준비한다. user id를 인자로 받지 않으며 활성 관리자는 거부한다.';
create or replace function public.finalize_account_withdrawal_server(
  target_withdrawal_id uuid,
  succeeded boolean,
  target_failure_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  has_retained_records boolean;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.account_withdrawal_order_records
    where withdrawal_id = target_withdrawal_id
    union all
    select 1
    from public.account_withdrawal_refund_records
    where withdrawal_id = target_withdrawal_id
  ) into has_retained_records;

  if succeeded then
    update public.account_withdrawals
    set
      status = 'completed',
      user_id = null,
      completed_at = coalesce(completed_at, now()),
      customer_name = case when has_retained_records then customer_name else null end,
      customer_email = case when has_retained_records then customer_email else null end,
      purged_at = case when has_retained_records then null else coalesce(purged_at, now()) end,
      failure_code = null,
      updated_at = now()
    where id = target_withdrawal_id;
  else
    update public.account_withdrawals
    set
      status = 'failed',
      failure_code = left(coalesce(nullif(target_failure_code, ''), 'UNKNOWN'), 120),
      updated_at = now()
    where id = target_withdrawal_id;
  end if;

  return found;
end;
$$;
comment on function public.finalize_account_withdrawal_server(uuid, boolean, text) is
  'service_role 전용 탈퇴 완료/실패 기록. 완료 즉시 Auth user id를 분리 보관 행에서 제거한다.';
create or replace function public.purge_expired_account_withdrawals_server()
returns table (
  orphaned_withdrawals_finalized integer,
  order_records_purged integer,
  refund_records_purged integer,
  withdrawal_identities_purged integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  finalized_count integer := 0;
  order_purge_count integer := 0;
  refund_purge_count integer := 0;
  identity_purge_count integer := 0;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  -- Auth 삭제는 성공했지만 직후 상태 갱신이 실패한 드문 장애를 자동 복구한다.
  update public.account_withdrawals as withdrawal
  set
    status = 'completed',
    user_id = null,
    completed_at = coalesce(withdrawal.completed_at, now()),
    failure_code = null,
    updated_at = now()
  where withdrawal.status = 'processing'
    and withdrawal.user_id is not null
    and not exists (
      select 1 from auth.users as account where account.id = withdrawal.user_id
    );
  get diagnostics finalized_count = row_count;

  delete from public.account_withdrawal_refund_records
  where retain_until <= now();
  get diagnostics refund_purge_count = row_count;

  delete from public.account_withdrawal_order_records
  where retain_until <= now();
  get diagnostics order_purge_count = row_count;

  -- 남은 자식 기록을 기준으로 카운트·최종 만료일을 다시 계산한다.
  with retained_summary as (
    select
      withdrawal.id,
      (
        select count(*)::integer
        from public.account_withdrawal_order_records as order_record
        where order_record.withdrawal_id = withdrawal.id
      ) as order_count,
      (
        select count(*)::integer
        from public.account_withdrawal_refund_records as refund_record
        where refund_record.withdrawal_id = withdrawal.id
      ) as refund_count,
      (
        select max(retain_until)
        from (
          select order_record.retain_until
          from public.account_withdrawal_order_records as order_record
          where order_record.withdrawal_id = withdrawal.id
          union all
          select refund_record.retain_until
          from public.account_withdrawal_refund_records as refund_record
          where refund_record.withdrawal_id = withdrawal.id
        ) as all_records
      ) as latest_retention
    from public.account_withdrawals as withdrawal
    where withdrawal.status = 'completed'
  )
  update public.account_withdrawals as withdrawal
  set
    order_record_count = summary.order_count,
    refund_record_count = summary.refund_count,
    retention_until = summary.latest_retention,
    customer_name = case when summary.latest_retention is null then null else withdrawal.customer_name end,
    customer_email = case when summary.latest_retention is null then null else withdrawal.customer_email end,
    purged_at = case
      when summary.latest_retention is null then coalesce(withdrawal.purged_at, now())
      else null
    end,
    updated_at = now()
  from retained_summary as summary
  where withdrawal.id = summary.id
    and (
      withdrawal.order_record_count is distinct from summary.order_count
      or withdrawal.refund_record_count is distinct from summary.refund_count
      or withdrawal.retention_until is distinct from summary.latest_retention
      or (summary.latest_retention is null and (
        withdrawal.customer_name is not null
        or withdrawal.customer_email is not null
        or withdrawal.purged_at is null
      ))
    );
  get diagnostics identity_purge_count = row_count;

  return query select
    finalized_count,
    order_purge_count,
    refund_purge_count,
    identity_purge_count;
end;
$$;
comment on function public.purge_expired_account_withdrawals_server() is
  'service_role cron 전용. 보관기한이 지난 탈퇴 주문·환불과 회원 식별정보를 파기한다.';
create or replace function public.get_owner_account_withdrawal_summary()
returns table (
  total_withdrawals bigint,
  retained_withdrawals bigint,
  expiring_within_30_days bigint,
  attention_required bigint,
  retained_order_records bigint,
  retained_refund_records bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(array['owner']::text[]) then
    raise exception 'owner admin access required' using errcode = '42501';
  end if;

  return query
  select
    count(*)::bigint,
    count(*) filter (
      where status = 'completed' and retention_until > now()
    )::bigint,
    count(*) filter (
      where status = 'completed'
        and retention_until > now()
        and retention_until <= now() + interval '30 days'
    )::bigint,
    count(*) filter (where status in ('processing', 'failed'))::bigint,
    coalesce(sum(order_record_count), 0)::bigint,
    coalesce(sum(refund_record_count), 0)::bigint
  from public.account_withdrawals;
end;
$$;
create or replace function public.get_owner_account_withdrawals(
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  withdrawal_id uuid,
  withdrawal_status text,
  customer_name text,
  customer_email text,
  requested_at timestamptz,
  completed_at timestamptz,
  retention_until timestamptz,
  purged_at timestamptz,
  failure_code text,
  order_record_count integer,
  refund_record_count integer,
  retained_amount bigint,
  orders jsonb,
  refunds jsonb,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  safe_offset integer := greatest(0, coalesce(p_offset, 0));
begin
  if not public.is_admin(array['owner']::text[]) then
    raise exception 'owner admin access required' using errcode = '42501';
  end if;

  return query
  select
    withdrawal.id,
    withdrawal.status,
    withdrawal.customer_name,
    withdrawal.customer_email,
    withdrawal.requested_at,
    withdrawal.completed_at,
    withdrawal.retention_until,
    withdrawal.purged_at,
    withdrawal.failure_code,
    withdrawal.order_record_count,
    withdrawal.refund_record_count,
    coalesce((
      select sum(order_record.amount)::bigint
      from public.account_withdrawal_order_records as order_record
      where order_record.withdrawal_id = withdrawal.id
    ), 0)::bigint,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'orderUid', order_record.order_uid,
          'productTitle', order_record.product_title,
          'productType', order_record.product_type,
          'amount', order_record.amount,
          'source', order_record.source,
          'status', order_record.status,
          'orderedAt', order_record.ordered_at,
          'retainUntil', order_record.retain_until
        ) order by order_record.ordered_at desc
      )
      from public.account_withdrawal_order_records as order_record
      where order_record.withdrawal_id = withdrawal.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'refundUid', refund_record.refund_uid,
          'amount', refund_record.amount,
          'reason', refund_record.reason,
          'status', refund_record.status,
          'requestedAt', refund_record.requested_at,
          'completedAt', refund_record.completed_at,
          'retainUntil', refund_record.retain_until
        ) order by refund_record.requested_at desc
      )
      from public.account_withdrawal_refund_records as refund_record
      where refund_record.withdrawal_id = withdrawal.id
    ), '[]'::jsonb),
    count(*) over ()::bigint
  from public.account_withdrawals as withdrawal
  order by withdrawal.requested_at desc
  limit safe_limit
  offset safe_offset;
end;
$$;
comment on function public.get_owner_account_withdrawals(integer, integer) is
  'Owner 전용 탈퇴·분리보관 현황. 법정 의무 및 분쟁 대응 목적의 최소 자료만 반환한다.';
revoke all on function public.prepare_my_account_withdrawal(text, boolean)
  from public, anon, authenticated;
revoke all on function public.finalize_account_withdrawal_server(uuid, boolean, text)
  from public, anon, authenticated;
revoke all on function public.purge_expired_account_withdrawals_server()
  from public, anon, authenticated;
revoke all on function public.get_owner_account_withdrawal_summary()
  from public, anon, authenticated;
revoke all on function public.get_owner_account_withdrawals(integer, integer)
  from public, anon, authenticated;
grant execute on function public.prepare_my_account_withdrawal(text, boolean)
  to authenticated;
grant execute on function public.finalize_account_withdrawal_server(uuid, boolean, text)
  to service_role;
grant execute on function public.purge_expired_account_withdrawals_server()
  to service_role;
grant execute on function public.get_owner_account_withdrawal_summary()
  to authenticated;
grant execute on function public.get_owner_account_withdrawals(integer, integer)
  to authenticated;
