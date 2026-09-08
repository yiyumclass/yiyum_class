# 로그인 접속기록 운영

## 기준 저장소

Vercel Runtime Logs나 Supabase Logs Explorer를 법정·정책상 기준 저장소로 사용하지 않는다.
로그인 접속기록의 기준 저장소는 애플리케이션 소유 테이블
`public.security_access_logs`이며, 플랫폼 플랜의 로그 보관기간과 독립적으로 운영한다.

## 기록 범위

- 카카오 로그인: OAuth 콜백의 성공, 교환 실패, 필수 동의 차단
- 기존 관리자·이메일 계정: 로그인 성공과 인증 실패
- 계정 식별값: 성공·탈퇴 차단은 사용자 ID, 이메일 인증 실패는 입력 이메일의 SHA-256 해시
- 접속 정보: 유효한 프록시 IP, 최대 512자의 User-Agent, Vercel 요청 ID

이메일·사용자 ID 원문, 비밀번호, 세션 쿠키, OAuth code, access/refresh token은 저장하지
않는다. 유효하지 않은 입력처럼 인증 서버까지 도달하지 않은 폼 검증 실패도 저장하지
않아 로그 채우기 공격의 범위를 줄인다.

## 접근 통제

테이블은 RLS를 활성화하고 `anon`, `authenticated`의 모든 직접 권한을 회수한다. 기록과
파기 RPC는 `service_role`만 호출할 수 있다. `/admin/privacy`는 매 요청 최고관리자 권한을
검사한 뒤 서버에서 제한된 필드만 조회한다. 운영 관리자와 일반 회원은 접근할 수 없다.
로그인 기록 실패는 정상 사용자의 로그인을
막지 않지만, 서버 로그에 `Failed to record security access event` 오류를 남기므로 배포
후 오류 알림에서 확인한다.

## 3개월 자동 파기

각 기록의 `retain_until`은 DB 함수가 `occurred_at + interval '3 months'`로 계산한다.
매일 실행되는 `/api/cron/expire-pending-orders`가
`purge_expired_security_access_logs_server()`를 호출해 만료 행을 삭제한다.

점검용 SQL:

```sql
select
  min(occurred_at) as oldest_record,
  max(occurred_at) as newest_record,
  count(*) as total_records,
  count(*) filter (where retain_until <= now()) as expired_records
from public.security_access_logs;
```

정상 상태에서는 `expired_records`가 일일 Cron 실행 이후 0이어야 한다. 운영자가 원문
식별값을 테이블에 추가하거나 보관기간을 임의로 연장해서는 안 된다.

## 현재 탈퇴 설계와의 경계

관리 화면은 현재 `account_withdrawals`의 처리 단계만 조회한다. 이전 초안의
`account_withdrawal_order_records`, hard delete, 거래자료 파기 RPC는 사용하지 않는다.
현재 주문·환불 원장과 탈퇴 차단용 tombstone을 자동 삭제하는 작업은 이 cron에 없다.
화면에서도 거래자료 자동 파기가 구현됐다고 표시하지 않는다.
