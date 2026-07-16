# 어드민: 회원 · 수강권 관리 설정

## 구현 범위

- `/admin/members` 전체 회원 목록과 검색
- 수강권 보유·미보유·30일 내 만료 회원 필터
- 전체 회원, 활성 수강권, 최근 가입, 만료 예정 요약
- 회원별 보유 상품·지급 경로·이용 기간 조회
- 상품 기본 기간, 무제한 또는 직접 지정 만료일로 수강권 지급
- 수강권 기간 변경, 회수와 재활성화
- 모든 지급·변경·회수 작업의 관리자 권한 재검사와 감사 로그

## 데이터베이스 설정

Supabase SQL Editor에서 아래 마이그레이션을 실행한다.

`supabase/migrations/20260715170000_create_admin_member_entitlements.sql`

이 파일은 다음 마이그레이션 이후에 적용해야 한다.

1. `20260714090000_create_admin_foundation.sql`
2. `20260714110000_create_products.sql`
3. `20260715150000_create_free_enrollments.sql`
4. `20260715160000_create_admin_order_ledger.sql`
5. `20260715170000_create_admin_member_entitlements.sql`

마이그레이션은 다음 관리자 전용 함수를 생성한다.

- `get_admin_member_entitlements()` — 전체 회원과 수강권 조회
- `admin_grant_product_entitlement()` — 수강권 지급·재지급
- `admin_update_product_entitlement()` — 상태·만료일 변경

모든 함수는 `public.is_admin()`을 다시 확인한다. 일반 회원은 다른 회원의 이메일이나
수강권을 조회·변경할 수 없다. 변경 작업은 `admin_audit_logs`에 대상 회원, 상품,
이전·변경 상태와 만료일을 기록한다.

## 화면 확인

관리자 계정으로 `/admin/members`에 접속한다.

- 사이드 메뉴의 `회원 · 수강권`이 활성 링크여야 한다.
- 마이그레이션 적용 후 `운영 데이터` 상태가 표시되어야 한다.
- Supabase Auth 회원과 회원별 보유 콘텐츠가 표시되어야 한다.
- 이름, 이메일, 회원 ID 검색과 수강권 필터가 함께 동작해야 한다.
- `수강권 관리`에서 상품과 이용 기간을 선택해 지급할 수 있어야 한다.
- 기간 저장, 회수, 재활성화 후 목록과 `/my` 접근 상태가 갱신되어야 한다.
- owner 대시보드의 최근 운영 변경에 수강권 작업이 표시되어야 한다.

## 운영 원칙

- 수강권 지급·변경·회수는 owner 전용이다. `admin_grant_product_entitlement`와
  `admin_update_product_entitlement`는 `public.is_admin(array['owner'])`로 권한을 확인한다.
  operator는 `get_admin_member_entitlements`로 회원·수강권을 조회할 수만 있고 지급·변경·회수는 할 수 없다.
- 콘텐츠 접근의 기준은 주문이나 로그인 여부가 아니라 유효한 수강권이다.
- 회수는 데이터를 삭제하지 않고 `revoked`로 보관한다.
- 만료일이 지난 `active` 수강권은 화면에서 `만료`로 계산하며 접근은 허용하지 않는다.
- 기존 무료 신청·결제 수강권을 관리자가 재지급하면 출처가 `admin_grant`로 기록된다.
- 실제 결제 취소·환불은 결제사 상태를 먼저 확정한 뒤 수강권 회수와 연결한다.
