# Toss 결제창형 QA — 2026-10-03

## 목표와 안전 범위

- 목표: 실제 로컬 구매 경로에서 테스트 결제 승인, 이용권 발급, 중복 방지, 환불 및 권한 회수를 검증한다.
- 중단 기준: 라이브 키, 실제 청구, 기존 고객 데이터 변경 또는 통제되지 않은 알림 발송이 필요하면 중단한다.
- 범위: `toss_test` 및 `CARD_ONLY`만 사용한다. 별도 QA 회원/주문만 생성하고 기존 회원·상품·주문은 수정하지 않는다.
- 외부 알림: 전화번호 없는 QA 회원을 사용하고 발송은 비활성화한다. 메시지 전송 자체는 격리된 모의 전송으로 검증한다.
- 기존 브랜치의 미커밋 구현은 보존하며 배포·커밋하지 않는다.

## 시나리오 매트릭스

| ID | 사용자/공격 모델·시나리오 | 실행 방법 | 기대 신호 | 실제 결과/수정 | 상태 | 근거 | 정리 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA-01 | 일반 구매자, 테스트 결제 성공 | 로컬 checkout → Toss → success | paid 주문 1개, active 이용권 1개 | 사용자 카드 인증 후 성공 화면, Toss DONE, 1,200,000원 승인, paid·active 각 1건 및 정책 동의 확인 | 통과 | 브라우저/실제 Toss 테스트 API/원격 QA 주문 | 테스트 결제 전액 취소 완료 |
| QA-02 | 수강생, 구매 전후 접근 | my/learn 및 영상 API | 구매 후 허용, 환불 후 거부 | 구매 전 checkout 이동. 구매 후 강의실·19강 목차·영상 토큰 200 및 플레이어 readyState 4. 환불 후 강의실은 checkout 이동, 영상 API 404/토큰 없음, 보유 콘텐츠 0건 | 통과 | 구매자 브라우저/영상 API | 재생 시작·완료 처리하지 않음 |
| QA-03 | 반복 클릭·새로고침 | 버튼 연속 클릭, confirm 재전송 및 SQL | 중복 주문·이용권·알림 없음 | 연속 클릭 시 pending 1건. 실제 승인 재전송 1회+동시 3회 모두 200/alreadyProcessed. 이용권·알림 각 1건 유지, 다른 paymentKey는 409 | 통과 | 실제 HTTP/원격 DB/격리 SQL | 발급 이용권은 환불로 회수 |
| QA-04 | 결제 취소 후 재시도 | 팝업 닫기 및 카드사 인증 취소 | 취소 주문은 이용권 없음, 재시도 가능 | 팝업·인증 취소 후 failed 및 새 요청 확인. 사용자 재시도 후 새 주문 승인, 이전 실패 주문으로 발급 없음 | 통과 | 브라우저/원격 QA 주문 | 최종 failed 3건, refunded 1건 보존 |
| QA-05 | 관리자 전액 환불 | 관리자 UI → Toss cancel 및 격리 SQL | CANCELED/refunded, 이용권 revoked | QA 주문만 검색 후 전액 환불 UI 실행. Toss CANCELED/잔액 0, refunded·revoked, 환불/감사 각 1건. UI 성공 메시지 확인 | 통과 | 실제 관리자 UI/Toss API/원격 DB | 테스트 결제 잔액 0 |
| QA-06 | 중복·위조 웹훅 | 로컬 webhook 및 격리 SQL | 중복 처리 없음, Toss와 불일치 거부 | 승인·취소 웹훅 각각 2회 모두 200. 승인 상태에 위조 CANCELED는 409. 재전송 후 환불/감사 각 1건 유지, 환불 후 재승인 409 | 통과(로컬 재전송) | 실제 Toss 조회를 사용하는 HTTP 핸들러/원격 DB | 공개 웹훅 자동 전달은 별도 |
| QA-07 | 비회원·타인·금액 변조·잘못된 본문 | confirm API 경계값 요청 | 4xx, 주문·권한 불변 | 비회원 401, 외부 Origin 403, JSON/누락/Unicode/초과/금액 400, 없는 주문·다른 로그인 회원 404 | 통과 | 로컬 HTTP 12개 시나리오 | QA 주문 상태 불변 |
| QA-08 | 알림 작업 중복·실패·환불 경합 | 알림 단위 테스트, 격리 SQL 및 QA 주문 한정 RPC | 단일 큐 기록, 안전한 재시도/중단 | 격리 동시성·롤백·권한 검사 통과. 실제 큐 1건/발송 시도 0, 환불 후 해당 주문 claim 결과 0건 | 통과(외부 전송 제외) | 145개 테스트/격리 SQL/원격 QA 큐 | 외부 알림 발송 없음 |
| QA-09 | 중단·재개·기존 변경 보존·timeout | 실행 전후 상태 및 bounded harness | 관련 임시 자원만 정리 | 인증 대기 후 실제 상태를 조회해 재개. 기존 변경 보존, 요청별 15~20초 제한, QA Auth soft delete 및 activeAccount=false 확인 | 통과 | git/fixture/로그인 화면 복귀 | 거래 원장 보존, 임시 브라우저·인증 파일 제거 |

프롬프트 인젝션/OMX 오래된 상태는 결제 도메인의 입력 처리 경로가 아니므로 결제 E2E 대상에서 제외한다. 테스트 출력의 성공 문구만으로 통과 처리하지 않고 종료 코드와 실제 상태를 대조한다.

## 실행 명령

- `[0] npm test` — 145/145 통과, 인증 완료 후 재실행도 145/145, 실패·skip 0, 약 0.58초.
- `[0] npm run verify:admin` — 익명 관리자 RPC 차단, 판매 상품·주문/동의/회원 원장 RPC 배포 확인.
- `[0] node --env-file=.env.local /tmp/yiyume-payment-qa/api-checks.mjs boundaries` — 실제 로컬 HTTP 경계값 12개 통과. HTTP 요청별 20초 제한.
- `[0] node --env-file=.env.local /tmp/yiyume-payment-qa/api-checks.mjs paid` — 실제 승인 재전송·동시 요청·승인 웹훅·위조 취소·다른 결제키 8개 통과.
- `[0] node --env-file=.env.local /tmp/yiyume-payment-qa/api-checks.mjs refunded` — 취소 웹훅 2회 및 환불 후 재승인 차단 3개 통과. 실제 HTTP 검사 합계 23개.
- `[0] node --env-file=.env.local /tmp/yiyume-payment-qa/verify-ledger.mjs paid|refunded` — 실제 Toss 조회와 QA 원장 대조. 환불 웹훅 재전송 후 다시 실행해 중복 없음 확인. 요청별 15초 제한.
- `[0] PGLITE_MODULE_PATH=/tmp/yiyume-payment-qa/node_modules/@electric-sql/pglite/dist/index.js node scripts/verify-payment-notifications-db.mjs` — 실제 PostgreSQL 알림 큐 상태 전이 통과.
- `[0] PGLITE_MODULE_PATH=/tmp/yiyume-payment-qa/node_modules/@electric-sql/pglite/dist/index.js node scripts/verify-toss-payment-flow-db.mjs` — 실제 마이그레이션의 핵심 테이블/최신 함수 정의를 최소 auth 환경에서 실행. 승인·환불·권한 회수·중복 방지 통과. 전체 Supabase 환경 또는 Toss API를 대신한 결과는 아니다.
- `[0] npx tsc --noEmit`, 변경 파일 ESLint, `git diff --check` 통과. 인증 후 타입 검사 및 새 SQL 검증 스크립트 ESLint도 재실행 통과.
- 브라우저: 별도 `yiyume-buyer`/`yiyume-owner` 세션. 실제 앱 결제 성공 → 수강 접근 → 관리자 환불 → 권한 회수 → 회원 주문 내역의 환불 상태 확인.

## 발견한 문제와 수정

- 이번 테스트 경로에서 재현된 애플리케이션 결함은 없다. 테스트 환경 E2E는 1회 검증 사이클로 완료했으며 모든 카드사·실기기·라이브 환경의 무결함을 의미하지 않는다.
- QA 도구 준비 중 SDK 배포 경로 가정 때문에 import가 실패했다. 저장소 기준 `createRequire`로 교정했으며 이 실패는 제품 결함이 아니다.
- SQL 검증 스크립트의 만료 시각 문자열 비교는 로컬 타임존에 의존했다. UTC 시각으로 정규화한 비교로 수정 후 통과했다.
- 정리 도구는 Auth 삭제 응답에 `deleted_at`이 있다고 가정해 assertion이 실패했다. 삭제를 재실행하지 않고 별도 조회로 `deleted_at`, 원래 이메일 제거, `is_active_account=false`, 브라우저 로그인 화면 복귀를 확인했다. 실제 soft delete는 성공했으며 제품 결함이 아니다.
- 재현 가능한 격리 검증 스크립트 `scripts/verify-toss-payment-flow-db.mjs`를 추가했다. 애플리케이션 코드는 이번 검증에서 변경하지 않았다.

## 정리 및 잔여 위험

- **테스트 결제 E2E 완료**: 사용자 본인 카드 인증 뒤 실제 Toss 테스트 승인과 전액 취소를 확인했다. 실청구는 없다. [토스 공식 테스트 안내](https://docs.tosspayments.com/blog/how-to-test-toss-payments). 카드번호·인증정보는 수집하지 않았다.
- 원장 식별용 QA 주문: `ORD-20261003-874681378af74e65a771a0ebdaaa123d`. 승인 시각은 2026-10-03 17:55:59 KST, 승인/취소 금액은 1,200,000원이다. 최종 Toss 상태 `CANCELED`, 잔액 0, 내부 `refunded`, 이용권 `revoked`, 성공 환불·환불 감사 각 1건이다.
- QA 계정은 Auth soft delete로 비활성화했고 원래 이메일이 제거된 것을 확인했다. 최종 실패 주문 3건·환불 주문 1건·회수 이용권 1건·미발송 큐 1건 및 환불/감사 기록은 원장 외래키와 이력 보존을 위해 유지한다. 활성 이용권과 발송 시도는 0건이다. 기존 고객·관리자 계정은 변경하지 않았다.
- `/tmp/yiyume-payment-qa`의 제한 접근 테스트 세션·fixture·API 결과·스크린샷·PGlite 임시 설치와 이전 임시 위젯 검증 파일을 제거했다. 별도 구매자/관리자 QA 브라우저를 종료하고 OMX QA 상태도 정리했다. 사용자의 기존 브라우저 세션과 로컬 개발 서버는 유지했다. 비밀키·세션·결제키는 Git에 기록하지 않았다.
- 재실행용 `scripts/verify-toss-payment-flow-db.mjs`와 이 검증 보고서는 의도적인 저장소 산출물이다. 기존 구현 변경은 보존했고 이번 QA에서 애플리케이션 코드는 수정하지 않았다.
- 토스 서버에서 로컬로의 실제 웹훅 전달은 공개 테스트 URL 없이 검증할 수 없으므로 로컬 재전송 검증과 구분한다. 외부 터널·웹훅 등록은 하지 않았다.
- 환불 후 강의실 재진입과 새 영상 토큰 발급은 차단된다. 이미 발급된 Mux 서명 토큰의 즉시 무효화는 별개다. 현재 구현의 토큰 유효기간은 차시 길이에 따라 30분~3시간이며 기존 토큰 만료 전 재생 차단은 이번 범위에서 검증하지 않았다.
- 외부 알림 실발송, 실제 모바일 카드 앱 전환, 카드사 8곳 각각의 승인·할부 승인, 기존 키로 승인한 결제의 새 키 조회·환불은 별도 검증이다. 실결제·라이브 UI 설정·운영 키 연결·Vercel 배포·커밋은 하지 않았다.

## 2026-10-04 커밋 전 재검증

- 테스트 145/145, `npx tsc --noEmit`, 변경 파일 ESLint, `npm run build`, `git diff --check`가 통과했다. 기존 결제 E2E를 다시 수행하거나 새 QA 결제를 생성하지 않았다.
- Vercel 읽기 전용 확인 결과 Production UI 키는 `DEFAULT` Config이나 클라이언트 키는 기존 `live_ck_`다. 운영 키 전환 전에는 작업 브랜치만 공유하며 `main` 반영·운영 배포를 보류한다.
- 원격 Preview에는 클라이언트 키와 UI 키가 아직 없었다. 운영/Preview 환경별 미완료 사항은 [설정 문서](./toss-payment-window.md)의 2026-10-04 기록을 따른다.
