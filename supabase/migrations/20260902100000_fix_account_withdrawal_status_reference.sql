-- PL/pgSQL exposes RETURNS TABLE column names as variables. The output column
-- named status therefore collided with the unqualified orders.status reference
-- while a new account withdrawal was being started.

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
    select 1
    from public.account_withdrawals as withdrawal
    where withdrawal.user_id = target_user_id
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
    select 1
    from auth.users as account
    where account.id = target_user_id
      and account.deleted_at is null
  ) then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.admin_users as admin_user
    where admin_user.user_id = target_user_id
      and admin_user.is_active
  ) then
    raise exception 'active_admin_account' using errcode = 'P0001';
  end if;

  -- Close abandoned payment orders under the same rule used by the cleanup cron.
  update public.orders as abandoned_order
  set status = 'failed', updated_at = now()
  where abandoned_order.user_id = target_user_id
    and abandoned_order.source = 'payment'
    and abandoned_order.status = 'pending'
    and abandoned_order.payment_key is null
    and abandoned_order.created_at < now() - interval '30 minutes';

  if exists (
    select 1
    from public.orders as payment_order
    where payment_order.user_id = target_user_id
      and payment_order.source = 'payment'
      and payment_order.status = 'pending'
  ) then
    raise exception 'payment_in_progress' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.payment_refunds as refund
    join public.orders as payment_order on payment_order.id = refund.order_id
    where payment_order.user_id = target_user_id
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

comment on function public.begin_account_withdrawal(uuid, text) is
  'service_role 전용. 진행 중 결제·환불을 확인하고 멱등한 회원 탈퇴 tombstone을 생성한다.';

revoke all on function public.begin_account_withdrawal(uuid, text)
  from public, anon, authenticated;
grant execute on function public.begin_account_withdrawal(uuid, text) to service_role;
