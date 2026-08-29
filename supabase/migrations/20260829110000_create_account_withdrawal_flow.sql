-- 회원 탈퇴를 문의 접수가 아닌 실제 처리 흐름으로 전환한다.
--
-- 결제·환불 원장은 보존하고, 수강권·학습 기록·현재 동의 상태는 파기한다.
-- 카카오 연결 해제와 Auth soft delete는 외부 API 작업이므로 애플리케이션 서버가
-- 이 테이블의 처리 상태를 이용해 멱등하게 이어서 수행한다.

create table public.account_withdrawals (
  user_id uuid primary key,
  provider text not null check (provider in ('kakao', 'email')),
  status text not null default 'processing'
    check (status in ('processing', 'completed')),
  provider_unlinked_at timestamptz,
  data_purged_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.account_withdrawals is
  '탈퇴 처리 tombstone. Auth 계정 삭제 후에도 이전 JWT와 처리 재시도를 차단하기 위해 보존한다.';
comment on column public.account_withdrawals.user_id is
  '거래 원장과의 내부 연결 및 재처리 방지에만 사용하는 이전 Auth 사용자 UUID.';

create index account_withdrawals_status_idx
  on public.account_withdrawals (status, created_at);

create trigger account_withdrawals_set_updated_at
  before update on public.account_withdrawals
  for each row execute function public.set_updated_at();

alter table public.account_withdrawals enable row level security;
revoke all on table public.account_withdrawals from public, anon, authenticated;
grant select, insert, update, delete on table public.account_withdrawals to service_role;

-- JWT가 아직 만료되지 않았더라도 탈퇴 처리에 들어간 계정은 회원으로 보지 않는다.
create or replace function public.is_active_account()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users as account
    where account.id = (select auth.uid())
      and account.deleted_at is null
  )
  and not exists (
    select 1
    from public.account_withdrawals as withdrawal
    where withdrawal.user_id = (select auth.uid())
  );
$$;

comment on function public.is_active_account() is
  '현재 JWT가 삭제되지 않았고 탈퇴 처리 중이 아닌 Auth 계정에 속하는지 판정한다.';

revoke all on function public.is_active_account() from public;
grant execute on function public.is_active_account() to anon, authenticated;

-- 탈퇴 tombstone이 생긴 뒤에는 오래 남은 JWT나 동시에 열린 창이 회원 데이터를
-- 다시 만들 수 없게 한다. 주문 상태는 웹훅·환불 처리를 위해 update를 허용하되,
-- 새 주문 생성만 막는다.
create or replace function public.reject_withdrawn_account_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := new.user_id;
begin
  if exists (
    select 1
    from public.account_withdrawals as withdrawal
    where withdrawal.user_id = target_user_id
  ) then
    raise exception 'account_withdrawal_in_progress' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.reject_withdrawn_account_write() from public, anon, authenticated;

create trigger reject_withdrawn_entitlement_write
  before insert or update on public.product_entitlements
  for each row execute function public.reject_withdrawn_account_write();

create trigger reject_withdrawn_progress_write
  before insert or update on public.lesson_progress
  for each row execute function public.reject_withdrawn_account_write();

create trigger reject_withdrawn_consent_write
  before insert or update on public.user_auth_consents
  for each row execute function public.reject_withdrawn_account_write();

create trigger reject_withdrawn_order_insert
  before insert on public.orders
  for each row execute function public.reject_withdrawn_account_write();

-- 외부 카카오 API를 호출하기 전에 탈퇴 가능 여부를 확정하고 tombstone을 세운다.
create or replace function public.begin_account_withdrawal(
  target_user_id uuid,
  target_provider text
)
returns table (
  provider text,
  status text,
  provider_unlinked boolean,
  data_purged boolean,
  started_now boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_now boolean := false;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if target_user_id is null
    or target_provider is null
    or target_provider not in ('kakao', 'email') then
    raise exception 'invalid_withdrawal_target' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_user_id::text, 0)
  );

  if exists (
    select 1 from public.account_withdrawals
    where user_id = target_user_id
  ) then
    return query
    select
      withdrawal.provider,
      withdrawal.status,
      withdrawal.provider_unlinked_at is not null,
      withdrawal.data_purged_at is not null,
      false
    from public.account_withdrawals as withdrawal
    where withdrawal.user_id = target_user_id;
    return;
  end if;

  if not exists (
    select 1 from auth.users
    where id = target_user_id and deleted_at is null
  ) then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.admin_users
    where user_id = target_user_id and is_active
  ) then
    raise exception 'active_admin_account' using errcode = 'P0001';
  end if;

  -- 결제창을 열지 않고 이탈한 오래된 주문은 기존 cron과 같은 기준으로 닫는다.
  update public.orders
  set status = 'failed', updated_at = now()
  where user_id = target_user_id
    and source = 'payment'
    and status = 'pending'
    and payment_key is null
    and created_at < now() - interval '30 minutes';

  if exists (
    select 1 from public.orders
    where user_id = target_user_id
      and source = 'payment'
      and status = 'pending'
  ) then
    raise exception 'payment_in_progress' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.payment_refunds as refund
    join public.orders as orders on orders.id = refund.order_id
    where orders.user_id = target_user_id
      and refund.status in ('requested', 'processing')
  ) then
    raise exception 'refund_in_progress' using errcode = 'P0001';
  end if;

  insert into public.account_withdrawals (user_id, provider)
  values (target_user_id, target_provider);
  created_now := true;

  return query
  select
    withdrawal.provider,
    withdrawal.status,
    withdrawal.provider_unlinked_at is not null,
    withdrawal.data_purged_at is not null,
    created_now
  from public.account_withdrawals as withdrawal
  where withdrawal.user_id = target_user_id;
end;
$$;

create or replace function public.mark_account_withdrawal_provider_unlinked(
  target_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_rows integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  update public.account_withdrawals
  set provider_unlinked_at = coalesce(provider_unlinked_at, now())
  where user_id = target_user_id
    and provider = 'kakao'
    and status = 'processing';

  get diagnostics changed_rows = row_count;
  return changed_rows > 0;
end;
$$;

create or replace function public.cancel_account_withdrawal(
  target_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_rows integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  delete from public.account_withdrawals
  where user_id = target_user_id
    and status = 'processing'
    and provider_unlinked_at is null
    and data_purged_at is null;

  get diagnostics changed_rows = row_count;
  return changed_rows > 0;
end;
$$;

-- 외부 연결 해제가 끝난 뒤 회원 전용 데이터만 한 트랜잭션에서 파기한다.
-- orders/payment_refunds는 관계 법령상 거래·분쟁 기록 보존을 위해 건드리지 않는다.
create or replace function public.finalize_account_withdrawal(
  target_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_withdrawal public.account_withdrawals%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_user_id::text, 0)
  );

  select * into target_withdrawal
  from public.account_withdrawals
  where user_id = target_user_id
  for update;

  if not found then
    raise exception 'withdrawal_not_started' using errcode = 'P0002';
  end if;
  if target_withdrawal.data_purged_at is not null then
    return true;
  end if;
  if target_withdrawal.provider = 'kakao'
    and target_withdrawal.provider_unlinked_at is null then
    raise exception 'kakao_unlink_required' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.orders
    where user_id = target_user_id
      and source = 'payment'
      and status = 'pending'
  ) then
    raise exception 'payment_in_progress' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.payment_refunds as refund
    join public.orders as orders on orders.id = refund.order_id
    where orders.user_id = target_user_id
      and refund.status in ('requested', 'processing')
  ) then
    raise exception 'refund_in_progress' using errcode = 'P0001';
  end if;

  delete from public.lesson_progress where user_id = target_user_id;
  delete from public.product_entitlements where user_id = target_user_id;
  delete from public.user_auth_consents where user_id = target_user_id;

  update public.account_withdrawals
  set data_purged_at = now()
  where user_id = target_user_id;

  return true;
end;
$$;

create or replace function public.complete_account_withdrawal(
  target_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_rows integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if exists (
    select 1 from auth.users
    where id = target_user_id and deleted_at is null
  ) then
    raise exception 'auth_account_not_deleted' using errcode = 'P0001';
  end if;

  update public.account_withdrawals
  set status = 'completed', completed_at = coalesce(completed_at, now())
  where user_id = target_user_id
    and data_purged_at is not null;

  get diagnostics changed_rows = row_count;
  return changed_rows > 0;
end;
$$;

revoke all on function public.begin_account_withdrawal(uuid, text)
  from public, anon, authenticated;
revoke all on function public.mark_account_withdrawal_provider_unlinked(uuid)
  from public, anon, authenticated;
revoke all on function public.cancel_account_withdrawal(uuid)
  from public, anon, authenticated;
revoke all on function public.finalize_account_withdrawal(uuid)
  from public, anon, authenticated;
revoke all on function public.complete_account_withdrawal(uuid)
  from public, anon, authenticated;

grant execute on function public.begin_account_withdrawal(uuid, text) to service_role;
grant execute on function public.mark_account_withdrawal_provider_unlinked(uuid) to service_role;
grant execute on function public.cancel_account_withdrawal(uuid) to service_role;
grant execute on function public.finalize_account_withdrawal(uuid) to service_role;
grant execute on function public.complete_account_withdrawal(uuid) to service_role;

-- 직접 테이블 조회도 탈퇴 tombstone을 확인한다.
drop policy if exists "Users can view their own lesson progress"
  on public.lesson_progress;
create policy "Users can view their own lesson progress"
  on public.lesson_progress for select to authenticated
  using ((select auth.uid()) = user_id and public.is_active_account());

drop policy if exists "Members can view own product entitlements"
  on public.product_entitlements;
create policy "Members can view own product entitlements"
  on public.product_entitlements for select to authenticated
  using ((select auth.uid()) = user_id and public.is_active_account());

drop policy if exists "Users can view their own auth consent"
  on public.user_auth_consents;
create policy "Users can view their own auth consent"
  on public.user_auth_consents for select to authenticated
  using ((select auth.uid()) = user_id and public.is_active_account());

drop policy if exists "Members can view own orders" on public.orders;
create policy "Members can view own orders"
  on public.orders for select to authenticated
  using (user_id = (select auth.uid()) and public.is_active_account());

-- 보존한 주문 원장은 탈퇴 JWT로 다시 조회되지 않게 한다.
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
  join public.products as product on product.id = orders.product_id
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
    and public.is_active_account()
  order by orders.created_at desc;
$$;

revoke all on function public.get_my_order_ledger() from public, anon;
grant execute on function public.get_my_order_ledger() to authenticated;

-- 무료 자료는 이용권 없이 로그인 여부만으로 열리므로 active 계정 검사를 명시한다.
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
        page.page_number <= product.preview_page_count
        or public.is_admin()
        or (product.price_krw = 0 and public.is_active_account())
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
        or (product.price_krw = 0 and public.is_active_account())
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

revoke all on function public.can_read_product_page(text) from public;
revoke all on function public.get_product_pages(text) from public;
grant execute on function public.can_read_product_page(text) to anon, authenticated;
grant execute on function public.get_product_pages(text) to anon, authenticated;
