-- SDK/네트워크 오류만으로 pending 주문을 닫지 않는다.
-- Toss failUrl로 돌아온 주문 중 아직 paymentKey가 기록되지 않은 건만 failed 처리한다.
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
    and status = 'pending'
    and payment_key is null;

  get diagnostics changed_rows = row_count;
  return changed_rows > 0;
end;
$$;

revoke all on function public.fail_toss_payment_order(text) from public;
grant execute on function public.fail_toss_payment_order(text) to authenticated;
