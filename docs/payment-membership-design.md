# 결제·회원 시스템 설계 문서

> 상태: **설계(구현 전)** · 대상: 이윰 홈 (Next.js 16 App Router)
> 결제: 토스페이먼츠(일회성 결제) · DB/인증: Supabase

---

## 1. 목표와 핵심 원칙

이윰 홈에 **회원 가입**과 **유료 콘텐츠 결제**를 붙인다. 지금은 강의 하나지만
앞으로 **여러 강의·전자책**이 올라가고 각각 개별 결제가 필요하다.

### 원칙: 가입과 결제를 분리한다

| 잘못된 모델 | 채택 모델 |
|---|---|
| "가입 = 결제" (가입하려면 돈을 내야 함) | **가입은 무료**, 콘텐츠마다 개별 결제 |
| 상품이 늘면 구조가 꼬임 | 상품 1개든 100개든 동일 구조 |

- **회원가입**: 무료. 누구나 Supabase Auth로 계정 생성.
- **상품(강의/전자책)**: 각각 결제. 결제 승인되면 해당 상품 **이용권(entitlement)** 부여.
- **콘텐츠 접근 판정**: "로그인했는가?"가 아니라 **"이 상품 이용권이 있는가?"** 로 판단.

이 구조가 실무 표준이고, 확장·환불·부분권한 관리가 전부 이 위에서 깔끔해진다.

### 계정 없이 어디까지 되나

토스페이먼츠는 **가입 없이 쓸 수 있는 공개 테스트 키**를 공식 문서에 제공한다.
이 키로 샌드박스 결제창을 띄우고 **테스트 카드로 결제 성공/실패 전체 플로우를 검증**할 수 있다.

- 지금 개발·테스트 가능: 결제위젯 → 서버 승인 → DB 기록 → 이용권 부여 **전 구간**
- 실제 계정이 필요한 순간: **라이브(실제 결제) 전환 그 시점 하나** → 발급받은 진짜 키로 환경변수만 교체

---

## 2. 아키텍처 개요

```
[브라우저]
  회원가입/로그인 ──▶ Supabase Auth (@supabase/ssr, 쿠키 세션)
  상품 상세 → "결제하기" ──▶ 토스 결제위젯 (NEXT_PUBLIC 클라이언트 키)
        │
        │ 결제 성공 리다이렉트 (?paymentKey&orderId&amount)
        ▼
[Next.js 서버]  app/api/payments/confirm  (Route Handler)
  1) 요청한 orderId의 금액을 DB에서 조회 → 위조 여부 검증
  2) 토스 /v1/payments/confirm 호출 (SECRET 키, 서버 전용)
  3) 승인 성공 → Supabase에 order = paid, entitlement 생성
        ▼
[Supabase Postgres]  orders / entitlements (RLS 적용)
```

핵심: **시크릿 키와 최종 승인은 100% 서버에서.** 금액은 클라이언트가 보낸 값을
믿지 않고 **서버가 DB에 저장해둔 금액과 대조**한다. (결제 금액 위변조 방어)

---

## 3. 데이터 모델 (Supabase)

Supabase Auth가 `auth.users`를 관리하므로 우리는 그 위에 도메인 테이블만 얹는다.

### 3.1 테이블

```sql
-- 공개 프로필 (auth.users 1:1 확장)
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text,
  created_at  timestamptz not null default now()
);

-- 판매 상품 카탈로그 (강의/전자책)
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,             -- URL 식별자
  type        text not null check (type in ('course','ebook')),
  title       text not null,
  price       integer not null,                 -- 원화, 정수 (서버 신뢰 기준값)
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 주문 (결제 시도 1건 = 1 row)
create table public.orders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  order_uid     text unique not null,           -- 토스에 넘기는 orderId
  amount        integer not null,               -- 주문 시점 확정 금액
  status        text not null default 'pending' -- pending | paid | canceled | failed
                  check (status in ('pending','paid','canceled','failed')),
  payment_key   text,                           -- 토스 승인 후 저장
  approved_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- 이용권 (결제 완료 → 콘텐츠 접근 권한)
create table public.entitlements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  product_id  uuid not null references public.products(id),
  order_id    uuid not null references public.orders(id),
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz,                       -- null = 무기한(평생), 기간제면 값 존재
  unique (user_id, product_id)                   -- 같은 상품 중복 이용권 방지
);
```

> **일회성 결제 + 확장 대비**: 지금은 `orders`/`entitlements` 구조로 일회성 결제만 처리.
> 나중에 구독이 필요하면 `subscriptions`, `billing_keys` 테이블을 **추가**하면 되고
> 기존 구조는 건드리지 않는다.

### 3.2 RLS (Row Level Security) — 필수

Supabase는 클라이언트에서 DB에 직접 접근하므로 RLS로 잠근다.

- `profiles`, `orders`, `entitlements`: **본인 것만** SELECT (`auth.uid() = user_id`)
- `orders`/`entitlements`의 **쓰기(INSERT/UPDATE)는 클라이언트에서 전면 차단** →
  오직 서버의 **service role 키**로만 기록 (결제 승인 라우트에서)
- `products`: 활성 상품은 **누구나 SELECT** (가격표), 쓰기는 관리자만

이렇게 하면 "사용자가 자기 주문을 임의로 paid로 바꾸는" 공격이 원천 차단된다.

---

## 4. 결제 플로우 (시퀀스)

```
사용자                브라우저             Next 서버              토스            Supabase
  │  결제하기 클릭  │                      │                    │                │
  │───────────────▶│  주문 생성 요청       │                    │                │
  │                │─────────────────────▶│ orders(status=pending, amount 확정)  │
  │                │                      │───────────────────────────────────▶│
  │                │◀─ orderId, amount ───│                    │                │
  │                │  결제위젯 open        │                    │                │
  │                │──────────────────────────────────────────▶│ (결제창 표시)   │
  │  카드 입력·인증 │                      │                    │                │
  │                │◀── successUrl 리다이렉트 (paymentKey,orderId,amount) ──────│
  │                │  /api/payments/confirm│                    │                │
  │                │─────────────────────▶│ ① DB금액 == 요청금액 검증            │
  │                │                      │ ② /v1/payments/confirm (SECRET) ──▶│
  │                │                      │◀────── 승인 성공 ──────────────────│
  │                │                      │ ③ order=paid + entitlement 생성 ───▶│
  │                │◀── 완료 페이지 ───────│                    │                │
```

### 실패/이탈 처리
- `failUrl`로 돌아오면 order를 `failed`로.
- 승인 API가 실패하면 order `pending` 유지(또는 `failed`), 이용권 **생성 안 함**.
- **멱등성**: 같은 `order_uid`가 이미 `paid`면 재요청 시 중복 승인/중복 이용권 금지.
- (권장) 토스 **웹훅** 추가로 서버-서버 결제 상태 동기화 → 리다이렉트 유실 대비.

---

## 5. 파일·라우트 구조 (Next 16 App Router)

```
src/
  lib/
    supabase/
      server.ts        # 서버 컴포넌트/라우트용 클라이언트 (쿠키 세션, @supabase/ssr)
      client.ts        # 브라우저용 클라이언트
      admin.ts         # service role 키 클라이언트 (서버 전용, 쓰기용)
    toss.ts            # 토스 승인 API 래퍼 (SECRET 키)
  app/
    (auth)/
      login/page.tsx
      signup/page.tsx
    actions/
      auth.ts          # 'use server' — signup/login/logout Server Actions
    products/
      [slug]/page.tsx  # 상품 상세 + 결제하기 버튼
    checkout/
      page.tsx         # 토스 결제위젯 마운트 (클라이언트 컴포넌트)
      success/page.tsx # 승인 결과 표시
      fail/page.tsx
    api/
      orders/route.ts            # POST: 주문 생성(pending) → orderId 발급
      payments/
        confirm/route.ts         # POST: 금액검증 + 토스승인 + 이용권부여
        webhook/route.ts         # (권장) 토스 웹훅 수신
    my/
      page.tsx         # 내 강의/전자책 (본인 entitlements)
  middleware.ts        # 보호 라우트 세션 체크 + 세션 갱신
```

- **인증 폼**: Server Actions(`app/actions/auth.ts`) 사용 — 서버에서만 실행되어 안전.
- **결제 승인**: Route Handler(`route.ts`) — 시크릿 키는 여기서만 사용.
- **접근 제어**: `/products/[slug]`의 콘텐츠 본문은 서버에서 `entitlements` 조회 후 렌더.

---

## 6. 환경변수

```bash
# .env.local  (커밋 금지 — .gitignore 확인)

# Supabase
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...        # 서버 전용, 절대 NEXT_PUBLIC 아님

# 토스페이먼츠 (지금은 공개 테스트 키, 라이브 전환 시 교체)
NEXT_PUBLIC_TOSS_CLIENT_KEY=test_ck_...   # 문서의 공개 테스트 클라이언트 키
TOSS_SECRET_KEY=test_sk_...               # 문서의 공개 테스트 시크릿 키 (서버 전용)
```

> 테스트 키의 실제 값은 토스페이먼츠 공식 문서(개발자센터)의 "테스트 키" 항목에서
> 최신 값을 그대로 복사해 넣는다. 코드에 하드코딩하지 않는다.

---

## 7. 보안 체크리스트

- [ ] **금액 검증**: 승인 전 `orders.amount`(DB) == 리다이렉트 `amount` 대조. 불일치 시 거부.
- [ ] **시크릿 키 서버 전용**: `TOSS_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`는 `NEXT_PUBLIC` 금지.
- [ ] **RLS 활성화**: 모든 도메인 테이블. 쓰기는 service role로만.
- [ ] **멱등성**: `order_uid` unique + 이미 paid면 재승인/중복 이용권 차단.
- [ ] **입력 검증**: 주문 생성 시 `product_id` 유효·활성 여부, 로그인 여부 확인.
- [ ] **HTTPS**: 배포(Vercel) 기본 제공. 결제는 https 필수.
- [ ] (권장) **웹훅 서명 검증**으로 상태 동기화 신뢰성 확보.

---

## 8. 구현 마일스톤 (제안)

1. **M1 — 인증 토대**: Supabase 프로젝트 생성, `@supabase/ssr` 연동, 회원가입/로그인/로그아웃, `profiles` 자동 생성 트리거, `middleware.ts` 세션.
2. **M2 — 상품·스키마**: 위 SQL 마이그레이션 적용, RLS 정책, 상품 상세 페이지, 시드 상품 1개.
3. **M3 — 결제 플로우**: 주문 생성 API → 토스 결제위젯 → 승인 API(금액검증+승인+이용권) → success/fail. **공개 테스트 키로 E2E 검증.**
4. **M4 — 접근 제어·마이페이지**: entitlement 기반 콘텐츠 게이팅, `/my`.
5. **M5 — 견고화(권장)**: 웹훅, 멱등성 강화, 환불/취소, 에러·로깅.
6. **M6 — 라이브 전환**: 아래 체크리스트.

---

## 9. 라이브 전환 체크리스트 (계정 발급 후)

- [ ] 토스페이먼츠 가맹점 심사·계약 완료
- [ ] 발급받은 **라이브 클라이언트/시크릿 키**로 환경변수 교체 (코드 변경 없음)
- [ ] 웹훅 URL을 운영 도메인으로 등록
- [ ] 실제 소액 결제 → 취소 테스트 1회
- [ ] 사업자 정보·환불 정책·이용약관 페이지 게시(전자상거래법 대응)

---

## 10. 확인 필요 / 미결정

- **인증 방식**: **카카오 로그인 우선**으로 결정 (진행 상황·보류 사유는 [auth-kakao-setup.md](./auth-kakao-setup.md)). 이메일+비밀번호는 대안으로 보류.
- **이용권 기간**: 일회성 결제의 이용권을 **평생(무기한)** 으로 볼지, **N개월 기간제**로 볼지 → `entitlements.expires_at` 정책 확정 필요.
- **첫 상품 정의**: 현재 강의를 첫 `products` row로 넣을 때 slug/가격/type 확정 필요.
- **환불 정책**: M5 범위. 토스 결제취소 API + entitlement 회수 로직.
