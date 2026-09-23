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
수신번호는 주문 소유자의 Auth 전화번호 또는 metadata phone/phone_number에서 가져온다.
전화번호가 없으면 발송을 시도하지 않고 실패 기록을 남긴다. SMS 대체 발송은 사용하지 않는다.

## 운영 반영

1. `20260923090000_create_payment_notifications.sql` 마이그레이션을 적용한다.
2. 운영의 `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_PF_ID`와 기존 `CRON_SECRET`을 확인한다.
3. `SOLAPI_PAYMENT_NOTIFICATIONS_ENABLED=true`를 **운영 환경에만** 설정하고 코드를 배포한다.
   로컬·프리뷰에는 설정하지 않는다. 테스트 결제도 실제 알림을 보내므로 테스트 시에는 이 값을 false로 둔다.
4. 새 결제의 `payment_notifications` 상태 및 SOLAPI 발송 이력을 확인한다.

마이그레이션 전의 과거 결제는 소급 등록하지 않는다. 마이그레이션 후 새로 paid가 되는 유료 멤버십만 큐에 등록된다.
활성화 전에 큐에 쌓인 테스트 주문은 운영 전 반드시 확인하고 `skipped`로 처리해야 한다.
활성화 후 queued 주문은 지연 발송될 수 있으므로 배포 시점에 큐를 확인한다.
DB 마이그레이션만으로 알림이 발송되지는 않는다. 비활성화는 환경변수를 false로 바꾸고 재배포한다.

## 중복 방지와 실패 처리

- 결제 상태 변경과 알림 작업 생성은 같은 DB 트랜잭션이다. 주문 ID 기본키로 1건만 생성한다.
- 승인 API(기존 paid 주문의 이용권 복구 포함)와 DONE 웹훅 모두 응답 후 `after`로 발송을 시도한다.
- `claim_payment_notification`에서 DB 잠금으로 한 작업자만 점유한다.
- `begin_payment_notification_send`가 주문·이용권과 작업 토큰을 다시 확인한 다음에만 외부 요청한다.
- 준비 단계 실패 또는 **확실한 접수 거절**은 `failed`. 최소 30분 간격, 최대 3번 점유 가능하다.
- 외부 요청 전 죽은 `preparing` 작업은 10분 후 새 토큰으로 회수 가능하다. 오래된 작업자는 발송할 수 없다.
- 기존 매일 18:00 UTC(한국시간 다음 날 03:00) Cron이 대기/실패 작업을 최대 10건 처리한다. 즉시 재시도 서비스가 아니며, 큐가 많으면 추가 처리가 필요하다.
- `accepted`는 **SOLAPI 접수 성공**이다. 카카오 최종 수신 결과는 SOLAPI에서 확인한다.
- 네트워크 단절/타임아웃/모호한 응답은 `unknown`. 발송 직후 프로세스가 종료되거나 DB 결과 기록이 실패하면 `sending`에 남을 수 있다.
- `sending`, `unknown`, `accepted`는 자동 재발송하지 않는다. 외부 발송의 정확히 한 번 보장은 불가능하므로, 불확실한 건은 누락 가능성을 감수하고 중복 방지를 우선한다.

서버 로그에는 주문 ID와 고정 오류 코드만 기록한다. 전화번호·이름·메시지 본문·인증값을 기록하지 않는다.
접수 실패가 결제 응답이나 수강권 발급을 되돌리지 않는다. 큐 테이블은 service_role만 접근 가능하다.

## 운영 확인 및 수동 복구

```sql
select n.order_id, o.order_uid, n.status, n.attempts, n.error_code,
       n.provider_message_id, n.provider_group_id, n.updated_at
from public.payment_notifications n
join public.orders o on o.id = n.order_id
order by n.created_at desc
limit 100;
```

`unknown` 또는 오래된 `sending`은 SOLAPI의 `customFields.orderId`와 발송 이력을 대조한다.
접수된 건은 message/group ID를 저장하고 accepted로 정리한다. **미접수가 확인된 경우에만** 해당 주문을 pending으로 되돌린다.
전화번호 누락은 회원 정보 보완 후 해당 작업을 pending으로 되돌릴 수 있다.
시도 횟수가 소진된 경우 운영자가 원인을 해결하고 확인한 작업에 한해 attempts를 0으로 초기화한다.
수동 변경 전 현재 상태·작업 시각을 확인하여 실행 중인 작업과 충돌하지 않게 한다.
이미 환불됐거나 이용권이 비활성인 주문은 발송 대상에서 제외된다.

## 검증

`npm test`의 템플릿 매핑, 한국시간 표시, 외부 요청 없는 전송 모의 테스트를 사용한다.
SQL 검증은 프로젝트 의존성을 바꾸지 않고 임시 PGlite(PostgreSQL WASM)에서 실행한다.

```sh
npm install --prefix /tmp/yiyum-notification-db-test --no-audit --no-fund @electric-sql/pglite
PGLITE_MODULE_PATH=/tmp/yiyum-notification-db-test/node_modules/@electric-sql/pglite/dist/index.js node scripts/verify-payment-notifications-db.mjs
```

과거 주문 제외, 트랜잭션 롤백, 재시도 횟수, 오래된 작업 토큰 차단, 환불 후 차단, 역할별 접근 제한을 검증한다.
실제 SOLAPI 발송 테스트는 별도 수신번호와 동의를 확보한 후 진행한다.

공식 참조: [발송 API](https://solapi.com/developers/api/messages), [HMAC 인증](https://solapi.com/developers/api/authentication-api-key).
