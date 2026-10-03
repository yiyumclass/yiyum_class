# 토스 결제창형 설정

결제 버튼은 토스가 제공하는 팝업을 연다. 카드사·할부·토스 약관 UI는 직접 만들지 않는다. 카드 등록/빌링 방식이 아닌 일회성 일반결제다.

## 상점 어드민

1. 결제 UI 설정에서 이윰의 일반결제 MID와 연결된 UI를 만든다. 예: `CARD_ONLY`.
2. 기능 → 결제수단 목록에서 신용·체크카드만 켠다. 간편결제·계좌이체·가상계좌·휴대폰·상품권은 끈다.
3. 기능 → 카드사 목록에서 모든 카드사 노출을 끄고, 심사 완료된 KB국민·BC·삼성·롯데·우리·하나·신한·NH농협만 남긴다. 현대카드는 심사 완료 확인 전까지 제외한다.
4. 할부 기본값은 일시불로 두고 실제 카드별 가능 개월 수·무이자 안내를 확인한다. 자체 UI에서 할부 개월 수를 고정하지 않는다.
5. 저장/게시 후 테스트·라이브 UI 모두 확인한다. UI 설정은 심사나 계약을 대신하지 않는다.

기본 결제수단 노출 설정은 Basic 기능이다. 특정 카드사를 별도 결제수단 버튼으로 강조하는 Pro 기능은 사용하지 않는다. 이벤트의 `paymentMethod.code`는 카드 선택 시 `CARD`이며 구체적인 카드사 번호가 아니므로, 현대카드 제외는 반드시 어드민에서 설정한다. 클라이언트의 CARD 검사만으로 서버 수준의 카드사 차단을 보장하지 않는다.

## 환경변수

개발자센터 → API 키 → **주문서형·결제창형 연동 키**에서 같은 환경의 키 한 쌍을 사용한다.

| 변수 | 테스트 | 운영 |
| --- | --- | --- |
| `PAYMENT_MODE` | `toss_test` | `toss_live` |
| `NEXT_PUBLIC_TOSS_CLIENT_KEY` | `test_gck_…` | `live_gck_…` |
| `TOSS_SECRET_KEY` | `test_gsk_…` | `live_gsk_…` |
| `NEXT_PUBLIC_TOSS_WIDGET_VARIANT_KEY` | 설정한 UI 키 | 설정한 UI 키 |

기존 API 개별 연동 키(`test_ck_`/`live_ck_`)를 재사용하면 안 된다. 코드가 키 종류·환경과 UI 키 유무를 검사하며, 잘못되면 신규 주문/결제창을 열지 않는다. 접두사 검사만으로 동일 계정의 유효한 키 한 쌍인지 검증되는 것은 아니다. `DEFAULT`도 해당 UI의 카드 전용 설정을 실제로 확인한 경우에만 사용한다.

시크릿 키는 서버 환경변수에만 저장한다. 채팅·문서·Git에 기록하지 않는다. 로컬 환경변수 변경 후 개발 서버를 재시작하고, 배포 환경은 환경변수 설정 후 재빌드한다. 개발용 공용 테스트 키를 실제 상점 환경변수에 대신 넣지 않는다.

Vercel에서 `NEXT_PUBLIC_TOSS_CLIENT_KEY`와 `NEXT_PUBLIC_TOSS_WIDGET_VARIANT_KEY`는 Config, `TOSS_SECRET_KEY`는 Secret으로 저장한다. `variantKey`는 발급받는 인증키가 아니라 화면 선택값이다. 기본 UI는 `DEFAULT`, 이번 테스트 추가 UI는 `CARD_ONLY`다. 저장된 Secret은 Config로 직접 변경할 수 없으므로 필요한 환경별 값을 확보한 뒤 해당 변수만 삭제·재생성해야 한다. 다른 인증키는 삭제하지 않는다.

## 기존 처리 유지

- 서버가 생성한 주문의 금액을 설정하고, 화면 금액과 다르면 중단한다.
- SDK는 `widgets()` → `setAmount()` → `renderPaymentWindow()` 순서로 호출한다.
- `paymentRequest` 이벤트에서 CARD만 허용하고 `widgets.requestPayment()`로 요청한다. 중복 요청을 차단한다.
- 취소·SDK 오류·페이지 이탈 시 창을 정리한다. 인증 진행 중에는 중복 팝업을 열지 않는다.
- 성공/실패 URL, 서버 승인 API, 이용권·알림·취소 처리는 기존 경로를 사용한다. 서버용 시크릿 키도 결제창형 키로 함께 교체해야 한다.
- 신규 결제창 설정 검사와 기존 승인·조회·웹훅 설정 검사는 분리한다. UI 키 누락만으로 기존 주문 처리를 막지 않는다.

## 배포 전 검증

- 실제 상점 테스트 키와 UI 키로 간편결제 없음·카드사 8개·현대카드 없음 확인.
- PC/모바일 팝업, 일시불·할부, 취소 후 재시도, 새로고침·페이지 이탈 확인.
- 승인된 실결제 테스트로 승인·이용권·알림 및 취소 확인. 기존 결제의 조회·환불도 키 전환 후 검증.
- UI 설정이 실제 저장/게시되었는지 확인하기 전에는 카드 전용 적용 완료로 간주하지 않는다.

## 2026-10-03 설정·검증 기록

- 히너스랩의 테스트 일반결제 MID `tvyiyumm991`에 `CARD_ONLY` UI를 추가하고 저장했다. 기존 `DEFAULT`와 라이브 UI는 변경하지 않았다.
- 신용·체크카드만 켜고 신한·삼성·롯데·하나·국민·비씨·농협·우리만 남겼다. 새로고침 후에도 설정이 유지되는 것을 확인했다.
- 할부는 제공하되 기본값을 일시불로 유지했다. 별도의 무이자 지원이나 가맹점 부담 할부 설정은 추가하지 않았다.
- 로컬에는 이 상점의 테스트 결제창형 키 한 쌍과 `CARD_ONLY`를 연결했다. `.env.local`은 원본 프로젝트와 공유되는 심볼릭 링크이며 키는 Git에 포함하지 않는다.
- 실제 상점 테스트 키로 SDK 검증 페이지에서 카드 8개 노출, 간편결제·현대카드 미노출, 국민카드 선택 후 할부 옵션, 닫기 후 재시도를 확인했다. 시크릿 키의 결제 조회 요청도 인증 오류 없이 처리됐다.
- 데스크톱과 iPhone 모바일 에뮬레이션에서 동일한 카드 8개를 확인했다. 실제 기기의 카드 앱 전환·인증은 별도 검증이 필요하다.
- 자동 테스트 145개, TypeScript 검사, 변경 파일 ESLint를 통과했다.
- 실제 상점 테스트 결제로 승인 → 이용권 발급 → 강의실/영상 접근 → 관리자 전액 환불 → 이용권 회수 및 새 영상 접근 차단을 확인했다. 승인/웹훅 중복·위조·권한 경계 검증과 정리 내역은 [QA 보고서](./toss-payment-qa.md)에 기록했다. 실청구는 없다.
- 라이브 `CARD_ONLY` 설정, 운영 키 연결, Vercel 환경변수 변경·배포는 하지 않았다. 공개 웹훅 자동 전달, 카드사별·실기기·할부 승인 및 기존 키로 승인된 주문의 새 키 환불은 별도 확인이 필요하다.

## 2026-10-04 푸시 전 확인

- 사용자가 라이브 기본 UI의 카드 8개 미리보기를 공유하고 저장 완료를 알렸다. 운영에는 이 기본 UI를 사용하며 별도 라이브 `CARD_ONLY` 생성을 요구하지 않는다. 실제 운영 팝업은 아직 검증하지 않았다.
- Vercel 프로젝트 `yiyume_home`의 Git 연결은 `yiyumclass/yiyum_class`, 운영 브랜치는 `main`이다. 작업 브랜치 푸시와 운영 브랜치 반영을 구분한다.
- 읽기 전용 API 조회로 Production의 `NEXT_PUBLIC_TOSS_WIDGET_VARIANT_KEY=DEFAULT` 및 Config 유형을 확인했다.
- **운영 전환 차단 사항:** Production 클라이언트 키의 접두사는 아직 `live_ck_`다. 새 결제창형 코드에는 같은 상점의 `live_gck_`/`live_gsk_` 쌍이 필요하므로 키 전환 전 `main` 반영은 하지 않는다. 키 본문은 출력하거나 저장하지 않았다.
- `TOSS_SECRET_KEY`와 `PAYMENT_MODE`는 Production/Preview 공용 Secret으로 등록되어 있다. 값은 확인하지 않았으며 올바른 운영 키 쌍·모드 설정을 검증한 것으로 간주하지 않는다.
- 조회 시점의 Preview에는 `NEXT_PUBLIC_TOSS_CLIENT_KEY`와 `NEXT_PUBLIC_TOSS_WIDGET_VARIANT_KEY`가 없었다. 원격 Preview 결제 검증에는 테스트 키 쌍·`toss_test`·`CARD_ONLY`를 환경별로 준비해야 한다. 로컬 테스트 성공이 원격 Preview 설정 완료를 의미하지 않는다.
- 푸시 전 자동 테스트 145개, TypeScript, 변경 파일 ESLint 및 로컬 프로덕션 빌드가 통과했다. 빌드는 로컬 테스트 결제 환경변수로 수행했으므로 운영 결제 연결 검증을 대신하지 않는다.

## 공식 근거

- https://docs.tosspayments.com/guides/v2/payment-widget/integration-window
- https://docs.tosspayments.com/sdk/v2/js/payment-window
- https://docs.tosspayments.com/guides/v2/payment-widget/admin
- https://docs.tosspayments.com/guides/v2/payment-widget/pro
- https://docs.tosspayments.com/reference/using-api/api-keys
