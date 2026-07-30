-- 결제창만 열고 이탈한 주문은 pending으로 남아 마이페이지에 "결제 대기"로 무기한
-- 노출된다. 지금은 사용자가 실패 페이지로 돌아오거나 같은 상품을 다시 주문할 때만
-- 정리되므로, 대부분의 이탈 주문이 그대로 쌓인다.
--
-- payment_key가 있는 주문은 절대 건드리지 않는다. 그것은 Toss 승인이 일어났는데
-- 이용권 발급이 끊긴 주문이라, 자동으로 실패 처리하면 "돈은 받고 못 준" 사실이
-- 가려진다. 그 건은 관리자 화면의 "이행 확인 필요"로 사람이 처리해야 한다.

create or replace function public.expire_stale_toss_payment_orders(
  target_older_than_minutes integer default 60
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_rows integer;
  cutoff timestamptz;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if target_older_than_minutes is null or target_older_than_minutes < 30 then
    -- Toss 결제 인증 유효시간이 30분이다. 그보다 짧게 잡으면 결제 진행 중인
    -- 주문을 실패로 만들 수 있다.
    raise exception 'cutoff must be at least 30 minutes' using errcode = '22023';
  end if;

  cutoff := now() - make_interval(mins => target_older_than_minutes);

  update public.orders
  set status = 'failed', updated_at = now()
  where source = 'payment'
    and status = 'pending'
    and payment_key is null
    and created_at < cutoff;

  get diagnostics changed_rows = row_count;
  return changed_rows;
end;
$$;

comment on function public.expire_stale_toss_payment_orders(integer) is
  '결제 승인 흔적이 없는 오래된 pending 주문을 failed로 정리한다. payment_key가 있는 주문은 대상에서 제외한다.';

revoke all on function public.expire_stale_toss_payment_orders(integer)
  from public, anon, authenticated;
grant execute on function public.expire_stale_toss_payment_orders(integer)
  to service_role;
