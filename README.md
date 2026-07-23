# 이윰 SNS 수익화 클래스

리빙 크리에이터 이윰의 SNS 수익화 VOD 클래스 플랫폼입니다. Next.js App Router 기반으로 랜딩, 과정 탐색, 결제 진입, 수강, 계정, 주문, 관리자 화면을 함께 다룹니다.

## 현재 구현 범위

- 랜딩 페이지: 강의 소개, 커리큘럼, 후기/인증 이미지 마퀴, 구매 CTA
- 인증 화면: 로그인, 회원가입, 약관 동의
- 과정 화면: 과정 목록, 과정 상세, 공개 과정 카탈로그
- 결제 화면: 유료 결제 진입, 무료 등록, 결제 성공/실패 처리
- 내 페이지: 수강 중인 클래스, 주문 내역, 계정 설정
- 학습 화면: 강의실, 학습 진행률 저장, 보호된 영상 접근 API
- 관리자 화면: 회원, 상품, 과정, 주문, 학습 진행률 관리
- 법적/정보 페이지: 약관, 개인정보처리방침, 문의, SNS 페이지

## 기술 스택

- Next.js 16 App Router, React 19, TypeScript
- ESLint 9, eslint-config-next
- Supabase Auth/Database/Storage 연동 모듈
- Toss Payments SDK 연동 모듈
- 전역 CSS, CSS Modules, 일부 인라인 스타일
- 로컬 검증 스크립트: 관리자 통합/탭 검증

## 개발

```bash
npm install
npm run dev
npm run lint
npm run build
npm start
```

개발 서버는 기본적으로 `http://localhost:3000`에서 실행됩니다. 로컬 접속은 `localhost`를 사용하세요.

## 주요 구조

```text
src/
  app/
    page.tsx                  # 랜딩
    courses/                  # 과정 목록/상세
    checkout/                 # 결제 진입/결과
    learn/[courseSlug]/       # 수강 화면
    my/                       # 내 클래스/주문
    account/                  # 계정 설정
    admin/                    # 관리자 화면
    api/                      # 학습/결제 API
  components/
    admin/                    # 관리자 UI
    auth/                     # 인증 UI
    checkout/                 # 결제 UI
    learning/                 # 강의실 UI
    layout/                   # 헤더/푸터/로딩
    my/                       # 내 페이지 UI
  lib/
    admin/                    # 관리자 데이터 접근/권한
    learning/                 # 학습 카탈로그/진행률/영상
    payments/                 # 결제 정책/토스 연동
    store/                    # 공개 카탈로그/상품/수강권
    supabase/                 # Supabase 클라이언트
scripts/
  verify-admin-integration.mjs
  verify-admin-tabs-live.mjs
```

## 환경 변수

실행 환경에는 Supabase, Toss Payments, 사이트 URL 관련 환경 변수가 필요합니다. 실제 값은 로컬 `.env*`나 배포 환경에만 설정하고 저장소 문서에는 기록하지 않습니다.

## 검증

```bash
npm run lint
npm run build
npm run verify:admin
npm run verify:admin-tabs
```

관리자 검증 스크립트는 필요한 외부 서비스 설정과 로컬 서버 상태에 따라 별도 준비가 필요할 수 있습니다.
