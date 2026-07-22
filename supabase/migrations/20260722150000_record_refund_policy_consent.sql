-- 유료 결제 주문에 결제 시점의 환불 정책 동의를 보존한다.

alter table public.orders
  add column if not exists refund_policy_version text,
  add column if not exists refund_policy_agreed_at timestamptz;

comment on column public.orders.refund_policy_version is
  '결제창을 열기 전에 동의한 환불 정책 버전.';
comment on column public.orders.refund_policy_agreed_at is
  '인증된 사용자가 환불 정책에 동의한 서버 시각.';

create or replace function public.record_toss_refund_policy_consent(
  target_order_uid text,
  target_policy_version text
)
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
  if target_policy_version <> '2026-07-22' then
    raise exception 'unsupported refund policy version' using errcode = '22023';
  end if;

  update public.orders
  set
    refund_policy_version = target_policy_version,
    refund_policy_agreed_at = coalesce(refund_policy_agreed_at, now()),
    updated_at = now()
  where order_uid = target_order_uid
    and user_id = actor_id
    and source = 'payment'
    and status = 'pending';

  get diagnostics changed_rows = row_count;
  return changed_rows > 0;
end;
$$;

revoke all on function public.record_toss_refund_policy_consent(text, text) from public;
grant execute on function public.record_toss_refund_policy_consent(text, text) to authenticated;
