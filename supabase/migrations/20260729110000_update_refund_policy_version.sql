-- 새 환불 정책에 동의한 결제 주문만 현재 정책 버전으로 기록한다.
-- 기존 주문의 정책 버전과 동의 시각은 변경하지 않는다.

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
  if target_policy_version <> '2026-07-29' then
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

revoke all on function public.record_toss_refund_policy_consent(text, text)
  from public, anon;
grant execute on function public.record_toss_refund_policy_consent(text, text)
  to authenticated;

comment on function public.record_toss_refund_policy_consent(text, text) is
  '현재 환불 정책에 대한 로그인 사용자의 동의를 본인 pending 결제 주문에 기록한다.';
