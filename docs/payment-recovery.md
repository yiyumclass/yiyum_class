# 결제 정합성 및 복구 운영

## 보장 범위

- 외부 승인 요청 **이전**에 DB에 승인 후보 키, 고정 멱등키, 복구 작업을 기록한다. 기록 실패 시 승인 API를 호출하지 않는다.
- 승인 결과가 불확실하면 주문을 실패로 닫거나 새 주문을 발급하지 않는다. 고객에게 재결제를 안내하지 않고 결제사 상태를 재조회한다.
- 주문의 `payment_mode`로 테스트/실결제를 분리한다. 환경 불일치 주문은 외부 승인·취소 API를 호출하지 않는다.
- 승인과 수강권 반영은 같은 DB 트랜잭션에서 처리한다. 구매 시 이용 기간을 스냅샷으로 보존한다.
- 수강권 원장은 주문별로 보존한다. 과거 주문 취소가 재구매 수강권이나 관리자 지급 권한을 회수하지 않는다.
- 관리자가 회수한 수강권은 결제 성공 요청을 재전송해도 자동 복원하지 않는다.
- 복구 작업은 120초 임대와 작업 토큰으로 중복 처리를 통제한다. 만료된 작업자는 재시도 상태를 덮어쓰지 못한다.
- 재승인은 처음 승인 의도가 기록된 주문에 한해, 동일 키의 `IN_PROGRESS` 상태를 결제사에서 재확인했을 때만 허용한다. `READY`, 404, 타임아웃만 보고 승인하지 않는다.
- 복구 작업은 최대 12회 후 검토 대상으로 남긴다. 환불 복구 작업은 조회만 하며 새로운 환불을 자동 실행하지 않는다.
- 부분취소는 전액환불로 간주하지 않고 검토 대상으로 기록한다.

분산 시스템에서 외부 API와 DB를 하나의 트랜잭션으로 묶을 수는 없다. 따라서 순간적 불일치를 숨기지 않고 **영속 기록 → 재조회 → 멱등 반영 → 해결되지 않는 건의 검토**로 수렴시킨다. 결제사/API/DB 장애 중 즉시 수강권 발급을 보장한다는 뜻은 아니다.

## 배포 전 필수 순서

1. 스테이징 전용 Supabase와 Toss 테스트 키를 사용한다. 로컬 `.env.local`이 운영 DB를 가리킬 수 있으므로 기존 통합 검증 스크립트를 무심코 실행하지 않는다.
2. 백업과 점검 시간을 확보하고 신규 결제 진입을 중지한다. 이전 서버 버전이 새 결제 RPC와 동시에 실행되지 않도록 한다.
3. `20261004160000_harden_payment_recovery.sql`을 스테이징에 먼저 적용한다. 운영 적용은 별도 승인 후 진행한다.
4. 기존 주문 백필 결과를 검토한다. `paid` 주문과 결제 수강권의 승인/부여 시각이 일치하고 후보가 하나인 경우에만 자동 연결한다. 애매한 이력은 현재 상품 설정을 추측하여 재발급하지 않는다.
5. 이전 주문의 테스트/실결제 환경은 추측하지 않는다. 소유자의 결제사 상태 재확인으로 실제 결제 조회가 성공한 뒤에만 연결한다. 구매 시 이용 기간이 남아 있지 않은 이력은 증빙 확인과 별도 관리 절차가 필요하다.
6. 마이그레이션과 호환되는 앱을 배포한다. 이전 버전으로 앱만 롤백하지 않는다. 문제 시 결제 진입을 먼저 중단하고 forward fix한다. 새 테이블 삭제로 롤백하지 않는다.
7. 프로덕션에 충분히 긴 무작위 `CRON_SECRET`을 Secret으로 설정한다. 브라우저용 `NEXT_PUBLIC_` 접두사를 붙이지 않는다.
8. 5분 주기 `/api/cron/reconcile-payments`는 기존 Supabase의 `pg_cron` + `pg_net`으로 실행한다. Vercel에는 기존 일일 정리 작업만 남겨 Hobby를 유지한다. 요금제 변경이나 새 유료 서비스 가입은 필요하지 않지만 DB·HTTP 실행은 기존 서비스의 사용량 한도에 포함된다. 아래 설정과 실제 HTTP 응답 검증을 완료해야 한다.
   이는 예약 실행의 기술적 구성 설명이다. Vercel은 Hobby를 개인·비상업용으로 안내하므로, 유료 강의 판매 사이트의 요금제 적합성은 별도로 확인해야 한다. 자동 복구를 옮겼다고 사이트 전체의 무료 상업 운영이 허용되는 것은 아니다.
9. 실제 사용하는 Toss MID의 `PAYMENT_STATUS_CHANGED` 웹훅 URL과 도착 로그를 확인한다. 코드가 있다고 웹훅 등록이 완료된 것은 아니다.
10. 아래 수용 테스트와 경보 수신 확인을 마친 뒤 신규 결제 진입을 재개한다.

## 검증

```sh
npm test
npm run verify:payments
npm run verify:payment-scheduler
npx tsc --noEmit
npm run lint
npm run build
```

`verify:payments`는 환경 파일을 읽거나 운영 DB에 접속하지 않는다. Docker 데몬이 사용 가능하면 임시 PostgreSQL 컨테이너를 사용한다. 그렇지 않으면 임시 디렉터리에 고정 버전 `embedded-postgres@18.4.0-beta.17`과 `pg@8.23.1`을 설치하고, 루프백 주소와 임의 포트로 격리 PostgreSQL을 실행한다. 처음 실행할 때 npm 다운로드가 필요하며 프로젝트 의존성이나 전역 설정은 변경하지 않는다. DB 프로세스는 종료 시 정리한다.

실제 PostgreSQL을 사용할 수 없으면 검증은 실패한다. `PAYMENT_DB_ALLOW_SERIAL_ONLY=1`을 명시한 경우에만 `PGLITE_MODULE_PATH`의 PGlite로 순차 전이 검사를 허용한다. 이는 다중 연결 동시성 검증을 대체하지 않으며 배포 수용 테스트로 인정하지 않는다.

필수 장애 시나리오:

- 승인 API 전 DB 실패 → 승인 요청 0회.
- 승인 성공 직후 앱 종료/DB 실패 → 재결제 없이 복구 작업 또는 웹훅으로 수강권 발급.
- 승인 응답 유실/중복 요청 → 고정 멱등키 사용, 새 주문 결제 차단.
- A 결제·환불 → B 재구매 → A 취소 재전송 → B 수강권 유지.
- 로컬 결제 키 저장 전 취소 → 결제사 검증 후 취소 기록, 다른 권한 유지.
- 관리자 회수/기간 변경/별도 지급 후 승인 재전송 → 관리자 결정 보존.
- 복구 작업 동시 점유/만료 토큰/12회 소진 → 단일 유효 임대와 검토 대기.
- 테스트 주문을 실결제 서버에서 처리 → 외부 요청 차단.
- 취소 웹훅이 먼저 도착하고 오래된 승인 이벤트가 나중에 도착 → 현재 결제사 상태 기준, 취소된 주문 부활 없음.

## Supabase 예약 실행 설정

1. `20261005090000_schedule_payment_recovery.sql`만 적용한다. 이미 적용한 결제 보완 SQL을 재실행하지 않는다. 이 마이그레이션은 확장과 비공개 호출 함수를 만들 뿐 예약 작업을 자동 활성화하지 않는다.
2. Supabase Vault에 `yiyume_payment_recovery_url`을 운영 HTTPS `/api/cron/reconcile-payments` URL로, `yiyume_payment_recovery_cron_secret`을 운영 Vercel의 `CRON_SECRET`과 같은 값으로 저장한다. 인증값은 32자 이상이어야 한다. 값을 소스·터미널 출력·작업 명령에 직접 기록하지 않는다.
3. 호환 앱 배포 후 DB 관리자 권한으로 `select payment_ops.invoke_payment_recovery();`를 실행한다. 반환된 ID에 해당하는 `net._http_response`에서 HTTP 200, `ok: true`, 복구 상태를 확인한다. 크론 작업의 `succeeded`는 HTTP 요청 접수 성공이지 결제 복구 성공이 아니다.
4. 검증 후 다음 작업을 등록한다. 같은 이름으로 등록하면 기존 작업이 갱신된다.

```sql
select cron.schedule(
  'yiyume-payment-recovery',
  '*/5 * * * *',
  'select payment_ops.invoke_payment_recovery();'
);
```

실제 예약 시각의 호출도 확인한다. `payment_ops.recovery_http_requests`의 요청 ID로 `net._http_response`를 조인해 HTTP 실패·타임아웃·응답 본문을 확인한다. 요청 ID 기록과 해당 크론의 실행 이력은 7일을 보관하고, `pg_net` 응답은 기본 6시간만 보관한다. 네트워크 큐가 유실돼도 결제 복구 원장은 유지되어 다음 실행에서 재조회한다.

호출 함수·기록은 비공개 `payment_ops` 스키마에 있으며 브라우저 역할과 `service_role`에 실행 권한을 주지 않는다. 중지는 DB 관리자 권한으로 `select cron.unschedule('yiyume-payment-recovery');`를 실행한다. 중지 후에는 자동 복구가 작동한다고 안내하지 않는다.

`verify:payment-scheduler`는 격리 PostgreSQL에서 SQL과 권한·정리 범위를 검사한다. 네트워크 함수는 스텁이므로 실제 Supabase 예약/HTTP 검증을 대체하지 않는다.

## 운영자가 보는 화면

소유자 계정의 `/admin/orders` 상단에 대기·검토·10분 이상 지연 건수와 오래된 작업 최대 20건이 표시된다. `결제사 상태 재확인`은 현재 상태를 읽어 내부 반영하는 기능이다. 새 결제나 환불을 실행하지 않는다. 자동 복구가 실패한 원인을 해결한 후 재확인할 수 있다.

검토 대상은 주문번호로 Toss와 내부 원장을 대조한다. 고객에게 다시 결제하도록 안내하지 않는다. 의도적인 관리자 회수나 부분환불은 재확인만으로 정책을 바꾸지 않는다. 결제 확인 없이 임의의 `paid` 변경/수강권 SQL 지급을 하지 않는다.

## 경보와 미완료 작업

코드는 복구 조회 실패, 검토 필요, 10분 이상 지연을 구조화된 서버 로그와 관리자 화면으로 드러낸다. **외부 Slack/메일/SMS 경보 수신 채널은 자동 설정하지 않는다.** 운영 배포 전 아래 감시와 담당자 수신 확인이 필수다.

- 복구 cron 미실행/5xx/비정상 종료, 복구 상태 조회 실패.
- `review_count > 0` 또는 `overdue_count > 0`.
- Toss 웹훅 반복 실패 및 테스트/실결제 모드 불일치.

Vercel 로그 기반 모니터 또는 별도 스케줄러의 응답 검사에 연결하고, 가짜 주문을 사용하는 스테이징 장애 주입으로 실제 경보 수신을 확인한다. 로그만 남는 상태를 자동 알림 완료로 취급하지 않는다.

## 공식 근거

- [Toss 멱등키와 인증](https://docs.tosspayments.com/reference/using-api/authorization): 키 유효기간은 15일이며, 구현은 보수적으로 14일 안에서만 자동 승인 재시도를 허용한다.
- [Toss 결제 API](https://docs.tosspayments.com/reference): 주문번호 기준 조회와 결제 상태 정의.
- [Toss 웹훅](https://docs.tosspayments.com/guides/v2/webhook): 웹훅 수신·응답 및 재전송 동작.
- [Vercel Cron 요금제 제한](https://vercel.com/docs/cron-jobs/usage-and-pricing): Hobby 하루 1회, Pro/Enterprise 분 단위 실행.
- [Vercel 요금제 용도](https://vercel.com/pricing): Hobby의 개인·비상업용 제한은 예약 실행 방식과 별개다.
- [Supabase Cron](https://supabase.com/docs/guides/cron): 기존 Postgres의 예약 실행.
- [Supabase pg_net](https://supabase.com/docs/guides/database/extensions/pg_net): 비동기 HTTPS 호출과 응답 확인.
- [Supabase Vault](https://supabase.com/docs/guides/database/vault): 스케줄러 인증값 암호화 보관.
