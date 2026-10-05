# 관리자 카톡 알림

## 사용 순서

1. 소유자(owner)로 **회원·수강권 → 회원 행의 카톡 알림**을 누른다. operator는 발송할 수 없다.
2. 연결된 SOLAPI 채널의 승인 템플릿을 선택한다. 기본·강조 텍스트형과 웹 링크 버튼을 지원한다. 이미지·아이템 리스트·앱 링크·광고형은 정확한 미리보기를 지원하기 전까지 제외한다.
3. 이름과 상품명은 서버의 회원·현재 수강권 정보로 채운다. 나머지 변수는 직접 입력한다.
4. 기존 베이직·부스터·프리미엄 결제 안내는 **관리자 지급 수강권의 현금 입금 확인용**이다. 실제 입금액(쉼표 없는 정수)과 실제 입금일(KST)을 입력하고 확인란을 체크한다. 상품 가격이나 지급일을 현금 입금으로 간주하지 않으며 주문·결제·수강권 원장을 수정하지 않는다.
5. **수신번호 확인 · 미리보기**에서 수신자, 마스킹한 번호, 강조 제목, 본문, 버튼 링크를 확인한다. 카카오에 동의된 번호를 다시 조회하며 임의 전화번호 입력은 지원하지 않는다.
6. 확인란을 체크하고 **확인한 내용으로 1건 발송**한다. 미리보기는 5분간 유효하다. 발송에는 SOLAPI 비용이 발생한다.
7. **결과 새로고침** 또는 기존 알림 Cron으로 전달 여부를 확인한다. 최초 확인은 발송 시작 약 2분 뒤, 이후 최소 5분 간격이다.

온라인 결제 안내는 기존 자동 발송 경로에서 처리한다. 이 화면에서 다시 보내지 않는다.
대량 발송, 이력 무시 재발송, 승인 본문 임의 편집, 문자 대체 발송은 제공하지 않는다.

## 설치 / 배포 순서

1. 기존 `20261005130000_harden_notification_contacts.sql`이 적용되어 있어야 한다.
2. `supabase/migrations/20261005150000_create_admin_notifications.sql`을 적용한다. 새 테이블은 RLS 활성화 및 anon/authenticated 접근 차단이 포함돼 있다. SQL 실행만으로 메시지가 발송되지 않는다.
3. 새 코드를 배포한다. `SOLAPI_ADMIN_NOTIFICATIONS_ENABLED`는 기본 비활성이다. 설정하지 않아도 기존 자동 결제 안내는 유지된다.
4. 실제 발송을 활성화할 **Production 환경에만** `SOLAPI_ADMIN_NOTIFICATIONS_ENABLED=true`를 설정하고 재배포한다. 서버 전용 Config이며 공개 접두사를 붙이지 않는다. Preview/Development는 false 또는 미설정으로 둔다.
5. 기존 서버 전용 `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_PF_ID`, `KAKAO_ADMIN_KEY`, Supabase service role을 재사용한다. 별도 키 발급이나 템플릿 ID 환경변수는 필요 없다.
6. 기존 `yiyume-payment-notifications` Cron이 `/api/cron/payment-notifications`를 호출하면 관리자 발송의 전달 결과도 조회한다. 새 Cron 등록은 필요 없다. 관리자 기능 플래그가 꺼져 있으면 새 테이블 조회를 하지 않는다.

운영 확인만을 위해 인증된 Cron을 직접 호출하지 않는다. 기존 자동 결제 알림 큐가 실제 발송될 수 있다.
중단하려면 관리자 기능 플래그를 false로 설정하고 재배포한다. 기존 자동 결제 알림 플래그와 독립적이다.

## 안전 장치 / 상태

- 모든 Server Action에서 owner를 검사하고, 발송 직전 DB에서도 활성 owner와 미리보기 작성자를 확인한다.
- 미리보기의 발송 대상·변수·템플릿 지문을 서버 DB에 저장한다. 확인 요청은 draft UUID만 받는다.
- 발송 직전 승인 템플릿, 카카오 전화번호 동의, 회원, 수강권을 다시 확인한다. 변경되거나 만료되면 새 미리보기를 요구한다.
- DB 잠금과 고유 인덱스로 같은 회원 또는 같은 수신번호·템플릿의 동시 발송을 차단한다. **현재 버전은 같은 회원·템플릿 1회만 허용**하며 변수만 바꿔서 다시 보내는 것도 막는다. 확실한 접수 거절도 운영 검토 없이 재시도하지 않는다.
- 기존 `payment_notifications`에 기록한 온라인·현금 안내와 SOLAPI의 기존 가입 안내 등도 발송 전 확인한다. 공급자 조회에 실패하거나 페이지를 끝까지 확인하지 못하면 발송하지 않는다. SOLAPI에만 있던 과거 이력은 사이트 목록에 모두 가져오지는 않지만 중복 차단에 사용한다.
- 외부 발송은 자동 재시도 없는 HTTP POST 1회다. 접수 여부가 불명확하면 다시 보내지 않는다.
- `accepted`: SOLAPI 접수, `delivered`: 공급자 결과 4000, `rejected`: 확실한 접수 거절, `delivery_failed`: 전달 실패, `unknown`: 접수 결과 불명, `review`: 수동 확인 필요.
- 외부 요청 직전 프로세스가 종료되면 실제로 미발송이어도 `sending`에 남을 수 있다. Cron은 `ADMIN-<draft UUID>` 추적값과 채널·템플릿을 대조해 결과만 복구한다. 24시간 동안 결과를 찾지 못하면 `review`. 이 상태를 임의로 초기화해 재발송하지 않는다.
- 실행자·마스킹 번호는 감사 로그, 실제 본문·변수 스냅샷은 서버 전용 알림 테이블에 보관한다. 전화번호 원문은 테이블이나 로그에 저장하지 않는다. 동의 조회는 기존 연락처 갱신 트리거를 호출하지 않으므로 미리보기만으로 자동 결제 안내를 재개하지 않는다.
- 탈퇴 또는 Auth 삭제 시 해당 회원의 관리자 알림 본문·변수 이력을 제거한다.

## 검증

실제 고객에게 발송하지 않는 검증:

```sh
npm test
npx tsc --noEmit
npm run lint
node scripts/verify-admin-notifications-db.mjs
node scripts/verify-notification-recovery-db.mjs
npm run verify:payments
```

DB 스크립트는 운영 Supabase가 아닌 임시 PostgreSQL에서 실행한다. 운영 키가 있는 `.env.local`로 발송 테스트를 실행하거나 실제 회원에게 시험 발송하지 않는다.

공식 API: [승인 템플릿 목록](https://solapi.com/developers/api/templates-getTemplateList), [템플릿 상세](https://solapi.com/developers/api/templates-getTemplate), [전달 이력 조회](https://solapi.com/developers/api/msg-getList).
