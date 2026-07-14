# 카카오 로그인 연동 — 진행 상황 & 재개 가이드

> 상태: **⏸ 보류 (To Be Continued)** — 비즈니스 앱 전환 대기 중
> 최종 업데이트: 2026-07-09
> 관련 설계: [payment-membership-design.md](./payment-membership-design.md)

---

## 한 줄 요약

Supabase + 카카오 로그인 코드/설정은 **거의 다 됐고**, 마지막 한 곳에서 막혀 보류.
**막힌 이유: Supabase가 카카오에 이메일(account_email)을 강제 요청하는데, 이메일은
비즈니스 앱 전환을 해야 권한이 생긴다.** 비즈앱 전환하면 바로 뚫린다.

---

## 지금까지 한 것 ✅

### 코드 (완료, 동작 확인됨)

| 파일 | 역할 |
|---|---|
| `.env.local` | Supabase URL + publishable key |
| `src/lib/supabase/client.ts` | 브라우저용 Supabase 클라이언트 |
| `src/lib/supabase/server.ts` | 서버용 클라이언트 (async cookies) |
| `src/lib/supabase/middleware.ts` | 세션 자동 갱신 로직 |
| `middleware.ts` (루트) | 매 요청 세션 갱신 |
| `src/app/login/page.tsx` | "카카오로 로그인" 버튼 |
| `src/app/auth/callback/route.ts` | OAuth 콜백 (code→세션 교환) |
| `src/app/account/page.tsx` | 로그인 확인 + 카카오 원본 데이터 표시 |

- 설치: `@supabase/supabase-js`, `@supabase/ssr`
- 검증: `/login` 200, `/account` 미로그인 시 307 리다이렉트 정상

### 카카오 개발자센터 (일부 완료)

- 앱 생성됨: **yiyum** (client_id: `e036c0e5b4c34892dc36bb205caabb86`)
- REST API 키 → Supabase Client ID에 등록됨
- Client Secret 발급 + 사용 ON
- Redirect URI 등록: `https://iipxllprppkzjovgfejb.supabase.co/auth/v1/callback`
- 카카오 로그인 **사용 설정 ON**
- 동의항목: **닉네임(profile_nickname)만** 활성화

### Supabase 대시보드 (완료)

- Authentication → Providers → **Kakao 활성화**, Client ID/Secret 입력
- URL Configuration: Site URL `http://localhost:3000`, Redirect URLs `http://localhost:3000/**`

---

## 막힌 지점 (핵심) 🚧

카카오 로그인 시 **KOE205 (잘못된 요청 / invalid_scope)** 발생.

authorize 요청 URL의 scope를 확인한 결과:

```
scope=account_email profile_image profile_nickname
```

- **Supabase의 Kakao 연동은 이 3개 scope를 항상 요청한다 (코드로 제거 불가).**
  - 클라이언트에서 `scopes` 를 지정해도 "교체"가 아니라 "추가"라 account_email이 안 빠짐.
- 그런데 카카오 앱에서 **account_email = "권한 없음"** 상태.
  - `profile_nickname`, `profile_image` 는 일반 앱도 켤 수 있음.
  - **`account_email` 은 비즈니스 앱 전환을 해야 권한이 생김.**
- 설정 안 된 scope를 요청 → 카카오가 거부 → **KOE205**.

### 참고: 겪은 에러들과 원인

| 에러 | 원인 | 해결 |
|---|---|---|
| KOE004 | (초기) Supabase Client ID가 다른 앱 키였음 | 올바른 REST API 키로 교체 |
| KOE205 | Supabase가 강제 요청하는 account_email이 앱에 미설정 | **비즈앱 전환 후 이메일 활성화 필요** ← 현재 여기 |

---

## 재개 방법 (To Be Continued) ▶

비즈니스 앱 전환만 하면 끝난다. **통신판매업 신고 없이, 사업자등록번호만으로** 전환 가능
(통신판매업은 토스 결제용이라 별개).

### 1. 비즈니스 앱 전환
- 카카오 개발자센터 → 앱 → **[비즈니스] → 비즈니스 앱 전환**
- **사업자등록번호** 입력 → 확인 (보통 즉시 처리)

### 2. 동의항목 활성화
- **[카카오 로그인] → [동의항목]** 에서:
  - **카카오계정(이메일)** → 설정 → **선택 동의** (선택 동의는 별도 검수 불필요)
  - **프로필 사진** → 설정 → 선택 동의
  - 닉네임은 이미 켜져 있음
- → Supabase가 요청하는 3개 scope가 전부 유효해짐

### 3. 재테스트
- dev 서버 실행: `npm run dev`
- **시크릿창**에서 `http://localhost:3000/login` → "카카오로 로그인"
- 승인 후 `/account`에 닉네임 등 표시되면 성공

### 4. (성공 후) 다음 단계
- 이름·전화번호가 더 필요하면 **동의항목 검수** 신청 (사유는 설계 문서 참고)
- 전화번호 항목은 검수 통과 후 `scopes`에 반영 (단, Supabase 기본 3개 외 추가 요청)

---

## 검수 제출 시 필요한 것 (카카오 동의항목 검수) 📋

카카오가 개인정보(이메일 등)를 넘겨주려면 **동의항목 검수**를 신청해야 하고,
신청 시 아래 **2개 URL**을 제출해야 한다. 심사자가 실제로 접속해 확인한다.

### 1. 회원가입/로그인 화면 URL
- "카카오로 로그인" 버튼이 실제로 보이는 화면.
- 우리는 이미 있음: `/login`, `/signup` (+ 결제 게이트 `/checkout` → `/login` 리다이렉트).
- ⚠️ **localhost 안 됨** — 배포된 실제 도메인이어야 함 (예: `https://도메인/login`).

### 2. 개인정보처리방침 URL
- 카카오에서 받은 개인정보(이메일/닉네임/이름 등)를 **무엇을·왜 수집하고,
  얼마나 보관하고, 어떻게 파기하는지** 적은 페이지. 개인정보보호법상 필수이기도 함.
- 회원가입 화면에도 이 방침을 링크(동의)로 걸어야 함.
- **아직 없음 → 만들어야 함** (예: `/privacy`).
- 최소 포함: 수집항목 / 이용목적 / 보유·이용기간 / 파기 / 제3자 제공·위탁 /
  이용자 권리 / 개인정보 보호책임자·문의처.
- 사업자 정보는 푸터에 있음: 히너스랩 · 대표 지예솔 · 866-03-03562 · yiyum.home@gmail.com

### 준비 체크리스트
- [ ] **배포(실제 도메인)** — localhost로는 제출 불가 ← 남은 것
- [x] `/privacy` 개인정보처리방침 페이지 작성 (2026-07-13)
- [x] `/terms` 이용약관 + 청약철회·환불 조항 작성 (2026-07-13)
- [x] 회원가입 화면에 **동의 체크박스** 추가 (필수: 만14세·이용약관·개인정보 / 선택: 마케팅)
- [x] 가입 필수 필드 확정: 이름·닉네임·이메일·전화번호 (선택정보는 가입 후 별도 수집)
- [x] 푸터에 개인정보처리방침·이용약관 링크 노출

> ⚠️ 법정문서는 **초안** 상태(각 페이지 상단 배너 명시). 공개·심사 제출 전 사업자 검토 필요.
> 특히 **환불·청약철회** 조항은 실제 운영 정책과 맞는지 확인할 것.

---

## 대안 (참고)

카카오를 계속 보류하려면, **이메일+비밀번호 자체 가입 폼**으로 먼저 출시하는 선택지도 있음
(Supabase Auth 이메일 로그인은 검수·비즈앱 불필요). 자세한 트레이드오프는 설계 문서 §10 참고.
현재 결정: **카카오 우선, 비즈앱 전환 시점까지 보류.**
