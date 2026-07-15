# 어드민 1단계 설정

## 이번 단계에서 구현되는 범위

- Supabase 회원을 기반으로 한 `owner` / `operator` 관리자 역할
- 일반 회원과 분리된 `/admin` 접근 제어
- 향후 상품·강의·전자책·주문·회원 관리 화면을 담을 공통 어드민 셸
- 관리자 작업 기록을 위한 `admin_audit_logs` 기반

관리자 여부는 이메일이나 `user_metadata`로 판정하지 않고
`public.admin_users` 테이블을 서버에서 조회해 판정한다.

## 1. 테이블 생성

Supabase SQL Editor에서 아래 마이그레이션 파일 전체를 실행한다.

`supabase/migrations/20260714090000_create_admin_foundation.sql`

## 2. 최초 owner 지정

앞서 확인한 `ymyi98@naver.com` 계정을 최초 owner로 사용할 경우 아래 SQL을 실행한다.
다른 계정을 관리자 계정으로 사용할 예정이면 UUID와 표시 이름을 교체한다.

```sql
insert into public.admin_users (
  user_id,
  role,
  display_name,
  created_by
)
values (
  '651bf6c5-0ad8-470b-9c4d-943ba26660a8',
  'owner',
  '이윰',
  '651bf6c5-0ad8-470b-9c4d-943ba26660a8'
)
on conflict (user_id) do update
set
  role = excluded.role,
  display_name = excluded.display_name,
  is_active = true,
  updated_at = now();
```

설정 후 해당 계정으로 로그인해 `/admin`에 접속한다. 역할은 매 요청마다 DB에서
확인하므로 JWT에 권한을 넣는 방식과 달리 로그아웃 후 다시 로그인할 필요는 없다.

## 보안 원칙

- `admin_users`에 없는 회원은 `/admin`에 접근할 수 없다.
- 브라우저에서는 관리자 역할을 추가·수정·삭제할 수 없다.
- `owner`만 관리자 목록과 감사 로그를 조회할 수 있다.
- 추후 관리자 변경 API는 서버에서 다시 `owner` 권한을 확인하고 감사 로그를 남긴다.
