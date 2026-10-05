# 결제 완료 알림톡

등록된 SOLAPI 본문·버튼은 변경하지 않는다. 환영 알림톡은 기존 `SOLAPI_WELCOME_TEMPLATE_ID` 설정을 사용한다.
결제 알림은 다음 매핑을 사용한다 (`src/lib/messaging/payment-message.ts`).

| 상품 slug | 클래스 | 템플릿 ID |
| --- | --- | --- |
| sns-monetization | 베이직 | KA01TP260922040813314fVYjYZjPBWX |
| sns-monetization-feedback | 부스터 | KA01TP260922041539999n9FFB1w868L |
| sns-monetization-ultra | 프리미엄 | KA01TP260922041738461z54SAXgqqVp |

변수는 `#{name}`, `#{product}`, `#{amount}`, `#{paymentDate}`다.
금액은 주문 원장의 결제금액에 천 단위 구분자를 붙인다. 일시는 승인 시각을 Asia/Seoul 기준으로 표시한다.
수신번호는 카카오 사용자 정보 API에서 회원번호와 전화번호 제공 동의를 검증한 뒤 사용한다.
서버 전용 `user_notification_contacts`에 저장하고 같은 카카오 회원번호의 24시간 이내 정보만 재사용한다.
신규 가입과 기존 회원 로그인은 연락처를 갱신한다. 결제 때 저장된 연락처가 없거나 만료됐으면
`KAKAO_ADMIN_KEY`로 재조회하므로 재로그인을 요구하지 않는다. Auth metadata의 전화번호는 신뢰하지 않는다.
동의·번호 누락은 `waiting_contact`로 분리하고 무작정 재시도하지 않는다. SMS 대체 발송은 사용하지 않는다.

## 운영 반영

1. 기존 결제·복구 마이그레이션이 적용된 환경에 `20261005130000_harden_notification_contacts.sql`,
   `20261005131000_prepare_notification_scheduler.sql`을 순서대로 적용한다. 두 번째 SQL은 호출 함수만 준비하고 스케줄을 활성화하지 않는다.
2. 운영의 `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_PF_ID`, `KAKAO_ADMIN_KEY`와 기존 `CRON_SECRET`을 확인한다.
   어드민 키는 로그인에 쓰는 카카오 앱의 키여야 하며 사용자 정보 조회 API 권한·호출 허용 IP를 확인한다.
3. `SOLAPI_PAYMENT_NOTIFICATIONS_ENABLED=true`를 **운영 환경에만** 설정하고 코드를 배포한다.
   로컬·프리뷰에는 설정하지 않는다. 테스트 결제도 실제 알림을 보내므로 테스트 시에는 이 값을 false로 둔다.
4. 배포 완료 후 아래 스케줄을 등록한다. 기존 Vault의 `yiyume_payment_recovery_url`과
   `yiyume_payment_recovery_cron_secret`을 재사용한다. 결제 복구 Cron은 변경하지 않는다.
5. 소유자 관리자 → 주문·결제 → **결제 알림톡 상태**에서 수신 완료·처리 중·확인 필요를 확인한다.

```sql
select cron.schedule(
  'yiyume-payment-notifications',
  '*/2 * * * *',
  'select payment_ops.invoke_payment_notifications();'
);
```

이 스케줄은 실제 운영 알림을 발송할 수 있다. 운영 DB에 테스트 주문을 만들거나,
단순 점검 목적으로 인증된 Cron 라우트를 호출하지 않는다. 작업 상태는 아래 읽기 전용 SQL로 확인한다.

```sql
select jobname, schedule, active from cron.job where jobname = 'yiyume-payment-notifications';
select request.requested_at, response.status_code, response.timed_out
from payment_ops.notification_http_requests request
left join net._http_response response on response.id = request.request_id
order by request.requested_at desc limit 10;
```

이번 마이그레이션은 과거 결제를 새로 큐에 등록하지 않는다. 기존 결제 알림 트리거는 새로 paid가 되는 유료 멤버십을 큐에 등록한다.
기존 `accepted` 알림은 전달 결과만 조회하며, 연락처 갱신으로 다시 발송하지 않는다.
활성화 전에 큐에 쌓인 테스트 주문은 운영 전 반드시 확인하고 `skipped`로 처리해야 한다.
활성화 후 queued 주문은 지연 발송될 수 있으므로 배포 시점에 큐를 확인한다.
DB 마이그레이션만으로 알림이 발송되지는 않는다. 비활성화는 환경변수를 false로 바꾸고 재배포한다.

## 중복 방지와 실패 처리

- 결제 상태 변경과 알림 작업 생성은 같은 DB 트랜잭션이다. 주문 ID 기본키로 1건만 생성한다.
- 승인 API(기존 paid 주문의 이용권 복구 포함)와 DONE 웹훅 모두 응답 후 `after`로 발송을 시도한다.
- `claim_payment_notification`에서 DB 잠금으로 한 작업자만 점유한다.
- `begin_payment_notification_send`가 주문·해당 주문의 이용권·환불 진행·회원 탈퇴·작업 토큰을 다시 확인한 다음에만 외부 요청한다.
- 준비 단계 실패 또는 **확실한 접수 거절**은 `failed`. 최소 30분 간격, 최대 3번 점유 가능하다.
- 외부 요청 전 죽은 `preparing` 작업은 10분 후 새 토큰으로 회수 가능하다. 오래된 작업자는 발송할 수 없다.
- 전용 2분 Cron은 최대 5건의 전달 결과를 조회하고 3건의 미접수 알림을 처리한다. 기존 일일 Cron도 보조 재시도를 수행한다.
- `accepted`는 **SOLAPI 접수 성공**일 뿐이다. 조회 API의 `4000`만 `delivered`(수신 완료)로 기록한다.
- 최종 실패는 `delivery_failed`, 알 수 없는 코드·중복 이력·24시간 이상 미확인은 `review`다. 이 상태들은 자동 재발송하지 않는다.
- 네트워크 단절/타임아웃/모호한 응답은 `unknown`. 발송 직후 프로세스가 종료되거나 DB 결과 기록이 실패하면 `sending`에 남을 수 있다.
- `sending`, `unknown`, `accepted`는 자동 재발송하지 않는다. 메시지 ID 또는 주문 추적값으로 이력을 조회해 상태만 복구한다.
  주문번호·채널·템플릿·메시지 유형을 확인하며, 이력 조회가 실패해도 새 발송으로 우회하지 않는다.
- 연락처 확인이 끝나면 최근 7일 이내 `waiting_contact` 중 외부 발송을 시작하지 않은 결제 완료 건만 다시 대기 상태로 전환한다.
- 연락처 테이블은 service_role만 접근하며, 탈퇴 시작 및 Auth soft/hard delete 시 삭제한다. 탈퇴 계정의 연락처 재생성을 차단한다.

서버 로그에는 주문 ID와 고정 오류 코드만 기록한다. 전화번호·이름·메시지 본문·인증값을 기록하지 않는다.
접수 실패가 결제 응답이나 수강권 발급을 되돌리지 않는다. 큐 테이블은 service_role만 접근 가능하다.

## 운영 확인 및 수동 복구

```sql
select n.order_id, o.order_uid, n.status, n.attempts, n.error_code,
       n.provider_message_id, n.provider_group_id, n.provider_status_code,
       n.delivered_at, n.delivery_checked_at, n.updated_at
from public.payment_notifications n
join public.orders o on o.id = n.order_id
order by n.created_at desc
limit 100;
```

`unknown` 또는 오래된 `sending`은 SOLAPI의 `customFields.orderId`와 발송 이력을 대조한다.
접수된 건은 자동 조회로 message/group ID와 결과를 반영한다. **조회 결과가 비었다는 이유만으로 pending으로 되돌리면 안 된다.**
API 반영 지연, 조회 범위, 페이지 누락을 검토하고 미접수를 별도로 확증한 경우에만 수동 재발송을 검토한다.
전화번호는 검증된 카카오 조회 경로로 보완한다. 사용자가 수정 가능한 metadata에 번호를 넣어 우회하지 않는다.
시도 횟수가 소진된 경우 운영자가 원인을 해결하고 확인한 작업에 한해 attempts를 0으로 초기화한다.
수동 변경 전 현재 상태·작업 시각을 확인하여 실행 중인 작업과 충돌하지 않게 한다.
이미 환불됐거나 이용권이 비활성인 주문은 발송 대상에서 제외된다.

## 검증

`npm test`는 카카오 조회·동의·계정 일치·캐시 만료·전달 결과·중복 차단을 외부 요청 없는 모의 테스트로 검증한다.
SQL 검증은 운영 환경과 연결하지 않는 임시 PostgreSQL에서 실행한다.

```sh
node scripts/verify-notification-recovery-db.mjs
npm run verify:payments
```

과거 주문 제외, 트랜잭션 롤백, 재시도 횟수, 오래된 작업 토큰 차단, 환불 후 차단, 역할별 접근 제한을 검증한다.
실제 SOLAPI 발송 테스트는 별도 수신번호와 동의를 확보한 후 진행한다.

공식 참조: [발송 API](https://solapi.com/developers/api/messages), [전달 이력 조회](https://solapi.com/developers/api/msg-getList),
[수신 결과 코드](https://solapi.com/message-status-codes), [카카오 사용자 정보 조회](https://developers.kakao.com/docs/ko/kakaologin/rest-api#req-user-info).
