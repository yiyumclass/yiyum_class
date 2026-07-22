-- 기본 PUBLIC 권한과 별개로 anon 역할에 남아 있을 수 있는 실행 권한도 명시적으로 제거한다.
-- 로그인하지 않은 요청은 주문이 0건이어도 회원 주문 RPC 자체를 호출할 수 없어야 한다.

revoke all on function public.get_my_order_ledger() from public, anon;
grant execute on function public.get_my_order_ledger() to authenticated;
