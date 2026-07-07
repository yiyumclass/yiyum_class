# 이윰 SNS 수익화 클래스

리빙 크리에이터 이윰의 SNS 수익화 강의 플랫폼. Next.js(App Router) 기반.

현재는 **랜딩 페이지**만 구현되어 있으며, 이후 로그인/회원가입 → 강의 관리(어드민) → 결제/수강권 순으로 확장 예정입니다.

## 기술 스택

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- 폰트: Pretendard(jsdelivr CDN), Song Myung(Google Fonts)
- 스타일: 전역 CSS + 인라인 스타일 (랜딩 이관본)
- 배포 타깃: Vercel

## 개발

```bash
npm install      # 최초 1회
npm run dev      # 개발 서버 → http://localhost:3000
npm run build    # 프로덕션 빌드
npm start        # 빌드 결과 실행
npm run lint     # ESLint
```

> 개발 서버 접속은 `localhost`를 사용하세요. `127.0.0.1`로 열면 Next.js가
> cross-origin dev 리소스를 차단해 클라이언트 컴포넌트가 하이드레이션되지 않습니다.

## 구조

```
src/
  app/
    layout.tsx        # 루트 레이아웃 · 메타데이터(title/OG) · lang=ko
    page.tsx          # 랜딩 페이지 (서버 컴포넌트)
    globals.css       # 폰트 import + 페이지 전역 스타일
    icon.svg          # 파비콘
  components/
    LandingInteractions.tsx  # 'use client' — 스크롤 reveal · nav 색 전환 · 스티키 구매 바
public/
  assets/profile.jpg  # 이윰 프로필 사진
```

## 이미지 슬롯 채우기 (후기·인증)

후기(`#reviews`)·수익화 인증 섹션 카드는 아직 빈 플레이스홀더입니다.
`src/app/page.tsx`에서 `className="... image-slot"` 인 `<div>`를 찾아 안에 `<img>`를 넣으면 채워집니다.

```tsx
{/* 변경 전 */}
<div id="rev1" className="imghover image-slot" style={{/* ... */}} data-slot="강의 후기"><span>강의 후기</span></div>

{/* 변경 후 */}
<div id="rev1" className="imghover image-slot" style={{/* ... */}}><img src="/assets/reviews/rev1.jpg" alt="강의 후기" /></div>
```

`.image-slot > img`는 `object-fit: cover`로 슬롯을 자동으로 채웁니다.
이미지는 `public/assets/` 아래에 두고 `/assets/...` 경로로 참조하세요.

## 실제 값으로 교체 필요 (placeholder)

- 네비게이션 **SNS** 링크 → 현재 `https://www.instagram.com/` (실제 계정 URL)
- Footer 통신판매업 신고번호 → `[신고 후 기재 예정]`
- **수강 신청/결제** → 현재 `#apply` 앵커 (추후 결제 플로우 연결)

## 배포 (Vercel)

1. 이 저장소를 GitHub에 push
2. [vercel.com/new](https://vercel.com/new) 에서 저장소 import (설정 자동 감지)
3. 환경변수 `NEXT_PUBLIC_SITE_URL` 에 실제 도메인 설정 (OG 이미지 절대경로용)

CLI 방식:

```bash
npx vercel        # 프리뷰 배포
npx vercel --prod # 프로덕션 배포
```

## 로드맵

- [x] 랜딩 페이지 이관 + 배포
- [ ] 로그인 / 회원가입 (Supabase Auth 또는 Clerk)
- [ ] 강의 데이터모델 + 어드민 등록
- [ ] 결제(토스페이먼츠/포트원) + 수강권 게이팅
