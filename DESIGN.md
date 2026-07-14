# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-13
- Primary product surfaces: 공개 랜딩, 인증, 마이 클래스, VOD 강의실, 전자책 열람, 주문/계정 관리
- Evidence reviewed:
  - `src/app/page.tsx`
  - `src/app/globals.css`
  - `src/app/account/page.tsx`
  - `src/app/checkout/page.tsx`
  - `src/app/my/page.tsx`, `src/app/my/my.module.css`
  - `src/app/courses/page.tsx`, `src/app/courses/courses.module.css`
  - `src/components/layout/SiteFooter.tsx`, `src/components/layout/SiteFooter.module.css`
  - `src/components/layout/SiteHeader.tsx`, `src/components/layout/SiteHeader.module.css`
  - `src/components/my/MyClassLibrary.tsx`
  - `src/components/auth/AuthForm.tsx`
  - `docs/payment-membership-design.md`
  - `docs/auth-kakao-setup.md`
  - `mobile-fixed-430.png`, `signup-page.png`, `yiyume-signup.png`
- Assumption: 지금은 VOD 강의 1개지만 여러 강의·전자책·묶음 상품으로 확장될 수 있다.

## Brand
- Personality: 따뜻함, 신뢰감, 차분한 전문성, 수강생에게 말을 거는 친근함.
- Trust signals: 명확한 수강 진도, 구매 상태, 이용 기간, 최근 학습 위치, 결제/문의 접근성.
- Avoid: 학습·구매·계정 용어가 섞이는 구조, 과도한 관리자 화면 느낌, 원본 사용자 ID/메타데이터 노출.

## Product goals
- Goals:
  - 로그인한 사용자가 구매한 콘텐츠와 다음 학습 행동을 5초 안에 찾는다.
  - 강의별 완료 차시와 전체 진도를 한눈에 확인한다.
  - VOD와 전자책을 같은 라이브러리에서 관리하되 각 콘텐츠에 맞는 행동을 제공한다.
  - 상품이 늘어나도 구매 권한과 학습 기록이 독립적으로 확장된다.
- Non-goals:
  - 마이 클래스에 미구매 상품을 구매 상품과 섞지 않는다.
  - 주문 성공만으로 콘텐츠를 노출하지 않는다. 유효한 이용권을 기준으로 한다.
  - 다운로드형 전자책에 근거 없는 읽기 진도율을 표시하지 않는다.
- Success signals:
  - 로그인 후 마이 클래스 진입률.
  - `이어보기` 클릭률과 다음 차시 재생률.
  - 수강생의 “어디까지 들었는지 모르겠다” 문의 감소.
  - 권한이 없는 콘텐츠 접근 차단 성공률 100%.

## Personas and jobs
- Primary personas:
  - 결제 후 처음 강의를 시작하는 신규 수강생.
  - 며칠 뒤 돌아와 마지막 위치부터 이어보려는 수강생.
  - 여러 강의와 전자책을 보유한 반복 구매 고객.
- User jobs:
  - 내가 구매한 콘텐츠인지 확인한다.
  - 마지막으로 본 강의와 다음 강의를 찾는다.
  - 완료한 차시를 체크하고 전체 진도를 파악한다.
  - 전자책을 다시 열거나 내려받는다.
- Key contexts of use: 모바일 우선, 짧은 시간에 재접속, 이동 중 재생, 느린 네트워크.

## Information architecture
- Primary navigation:
  - 비로그인: `강의 · 전자책 · 후기 · 문의 · 로그인 · 수강 신청`
  - 로그인: `강의 · 전자책 · 후기 · 문의 · 마이 클래스 · 수강 신청`
  - `마이 클래스`는 갈색 텍스트와 활성 밑줄로 표시한다. 판매 CTA인 `수강 신청`과 같은 채움 버튼을 사용하지 않는다.
  - `수강 신청` 노출은 로그인 여부가 아니라 현재 상품의 이용권 보유 여부로 결정한다. 미보유 회원에게는 유지하고, 보유 회원에게는 `이어보기` 또는 `강의실 입장`으로 교체한다.
  - 홈·강의·SNS·문의·법정문서 등 공개 페이지는 동일한 `SiteHeader`의 72px 높이, 1200px 컨테이너, 메뉴 순서와 좌표를 공유한다.
  - 공개 페이지 이동 시 메뉴 위치는 바꾸지 않고 현재 페이지에 해당하는 메뉴의 갈색 텍스트·밑줄만 변경한다.
  - 홈은 헤더 좌표를 유지한 채 최상단에서만 투명하고 스크롤 후 크림색 블러 배경으로 전환한다.
  - 로그인·회원가입, 마이 클래스, VOD 강의실은 각 작업에 집중할 수 있는 목적형 헤더를 사용한다.
- Canonical terminology:
  - `마이 클래스`: 구매한 콘텐츠 전체를 모아 보는 회원 라이브러리.
  - `VOD 강의실 입장`: 아직 시작하지 않은 강의 카드의 CTA.
  - `이어보기`: 수강 기록이 있는 강의 카드의 기본 CTA.
  - `강의실`: 영상, 커리큘럼, 차시 진도가 표시되는 실제 학습 화면.
  - `마이페이지`: 주문/결제 내역과 계정 설정을 포함하는 상위 계정 영역. 전역 핵심 CTA로는 사용하지 않는다.
- Core routes/screens:
  - `/courses`: 구매 가능한 공개 강의 목록. 강의가 1개일 때는 대표 강의를 넓게 설명하고, 추가되면 동일한 카드 구조를 반복한다.
  - `/my`: 마이 클래스 기본 화면.
  - `/learn/[courseSlug]`: VOD 강의실.
  - `/read/[ebookSlug]`: 인앱 전자책 리더가 있을 때의 열람 화면.
  - `/account/orders`: 주문/결제 내역.
  - `/account/settings`: 프로필·계정 설정.
  - 기존 `/account`는 완성 시 `/my` 또는 계정 개요로 리다이렉트한다.
- Global footer:
  - 홈, 강의 목록, SNS·문의, 개인정보처리방침·이용약관 등 공개/판매 페이지에는 사업자 정보 전체형을 공통 사용한다.
  - 로그인·회원가입·결제·마이 클래스에는 법정 링크와 판매자 식별 정보만 남긴 간결형을 사용한다.
  - `/learn/[courseSlug]` 강의실은 영상 학습 집중과 세로 공간 확보를 위해 전역 푸터를 표시하지 않는다.
- Content hierarchy for `/my`:
  1. 인사말과 가장 최근 학습의 `이어서 학습하기` 카드.
  2. 필터 탭 `전체 · VOD 강의 · 전자책 · 완료`.
  3. 유효한 이용권이 있는 콘텐츠 카드 목록.
  4. 별도 구역의 추천 콘텐츠. 반드시 `미구매`로 표시하고 보유 콘텐츠와 시각적으로 분리한다.
- Content hierarchy for `/courses`:
  1. 페이지 목적과 공개된 강의 수를 알리는 간결한 인트로.
  2. 이미지, 강의명, 핵심 주제, 수강 정보, 가격, 상세/신청 CTA를 포함한 강의 카드.
  3. VOD 학습과 진도 저장, 문의 방법을 설명하는 구매 전 안내.
- Course card:
  - 썸네일, 강의명, 상태 배지, 완료 차시/전체 차시, 진도 막대, 마지막 학습 차시, 이용 기간.
  - 미시작 CTA: `VOD 강의실 입장`.
  - 수강 중 CTA: `이어보기`.
  - 완료 CTA: `다시 보기`.
- Ebook card:
  - 표지, 제목, 형식, 구매/이용 상태, 마지막 열람일, 이용 기간.
  - CTA: `전자책 보기` 또는 정책에 따라 `다운로드`.

## Design principles
- Access before progress: 구매 권한과 학습 진도를 서로 다른 상태로 취급한다.
- Resume first: 다시 온 수강생에게 최근 미완료 차시와 `이어보기`를 가장 먼저 보여준다.
- One term, one role: `마이 클래스`, `강의실`, `이어보기`의 역할을 섞지 않는다.
- Honest progress: 측정 가능한 데이터만 진도로 표현한다.
- Progressive complexity: 강의가 1개일 때도 간결하고 20개가 되어도 필터와 카드 구조가 유지되어야 한다.
- Tradeoffs:
  - 홈에서 사용자 이름까지 조회하기보다 로그인 여부만 확실히 표시해 속도와 단순성을 우선한다.
  - 완료 차시 수는 체크 기준으로 별도 표시하고, 강의 전체 진도율은 각 차시를 동일 비중으로 두어 완료 차시는 100%, 미완료 차시는 마지막 재생 위치만큼 합산한다.
  - 전체 진도율과 함께 현재 차시의 시청률을 표시해 짧은 학습도 즉시 확인할 수 있게 한다.

## Visual language
- Color:
  - Background `#F3EFE8`, surface `#FBF8F2`, primary text `#201C17`.
  - Primary brown `#B85C38`, secondary orange `#D9825E`.
  - 홈의 `마이 클래스`는 갈색 텍스트와 밑줄을 사용하고, 마이 클래스 화면 내부 활성 탭에만 갈색 채움 스타일을 사용할 수 있다.
  - 완료 체크는 갈색 원형 체크를 기본으로 하고 색만으로 상태를 구분하지 않는다.
- Typography: Pretendard 본문, Noto Serif KR 제목. 기존 `serif` 클래스를 재사용한다.
- Spacing/layout rhythm: 데스크톱 최대 1200px, 24–40px 여백, 카드 간격 16–24px.
- Shape/radius/elevation: 10–16px 라운드, 얕은 테두리, 필요한 카드만 약한 그림자.
- Motion: 진도 업데이트와 탭 전환은 150–250ms. 과도한 축하 애니메이션은 피한다.
- Imagery/iconography: 강의 썸네일과 전자책 표지를 4:3/3:4로 구분. 체크 아이콘에는 텍스트 상태를 함께 제공한다.

## Components
- Existing components to reuse:
  - `LandingInteractions`, 기존 브랜드 색상과 타이포그래피.
  - `src/lib/supabase/server.ts`의 서버 세션 검증.
- New/changed components:
  - `AccountShell`: 마이 클래스/주문/계정 설정 공통 레이아웃.
  - `MyClassTabs`: 전체/VOD/전자책/완료 필터.
  - `ContinueLearningCard`: 최근 학습 1건 강조.
  - `OwnedContentCard`: course/ebook 변형.
  - `ProgressBar`: 완료 차시와 퍼센트의 접근 가능한 표현.
  - `CurriculumSidebar`: 챕터/차시/완료 체크/현재 재생 위치.
  - `LessonPlayer`: 재생 위치 저장 및 완료 판정.
  - `EntitlementBadge`: 수강 중/완료/만료 예정/만료 상태.
  - `SiteFooter`: 공개 페이지용 `full`, 인증·회원 영역용 `compact`, 어두운 결제 화면용 `dark` 변형.
  - `SiteHeader`: 공개 페이지용 공통 내비게이션. `solid | overlay` 배경과 페이지별 활성 메뉴 상태를 지원하며 서버에서 로그인 여부를 확인한다.
- Variants and states:
  - course: not-started, in-progress, completed, expiring, expired.
  - ebook: available, opened, expiring, expired.
  - access: entitled, not-entitled, pending, revoked.
- Token/component ownership: 기존 전역 색상과 타이포그래피를 우선하고 마이 클래스 전용 임의 색상 체계를 만들지 않는다.

## Accessibility
- Target standard: WCAG 2.2 AA 수준을 목표로 한다.
- Keyboard/focus behavior: 탭, 커리큘럼 차시, CTA, 완료 토글 모두 키보드로 접근 가능해야 한다.
- Contrast/readability: 갈색 활성 탭은 밝은 배경/텍스트와 4.5:1 이상 대비를 확보한다.
- Screen-reader semantics:
  - 필터는 실제 tab 또는 명확한 버튼 그룹으로 구현한다.
  - 진도는 `현재 12강 완료, 전체 32강, 38퍼센트`처럼 읽힌다.
  - 완료 체크는 장식 아이콘이 아니라 상태 텍스트를 포함한다.
- Reduced motion and sensory considerations: `prefers-reduced-motion`에서 진도/전환 애니메이션을 제거한다.

## Responsive behavior
- Supported breakpoints/devices: 360px 이상 모바일, 태블릿, 1200px 데스크톱.
- Layout adaptations:
  - 데스크톱: 계정 사이드 내비 + 2–3열 콘텐츠 카드.
  - 모바일: 상단 `마이 클래스` 제목, 가로 스크롤 필터, 1열 카드.
  - VOD 강의실 모바일: 영상 위, 커리큘럼 아래. 현재/다음 차시 CTA는 접근하기 쉽게 고정할 수 있다.
  - 차시 이동 버튼은 강의 제목을 반복하지 않고 `이전 강의`·`다음 강의`만 표시한다. 데스크톱에서는 양끝의 짧은 버튼으로, 모바일에서는 동일 행의 2열로 배치한다.
- Touch/hover differences: 체크/CTA 터치 영역 최소 44px. hover에만 정보를 숨기지 않는다.

## Interaction states
- Loading: 카드와 진도 스켈레톤. 권한 판정 전 콘텐츠 링크를 먼저 노출하지 않는다.
- Empty:
  - `아직 보유한 클래스가 없어요.`
  - 보조 CTA `클래스 둘러보기`, `전자책 둘러보기`.
- Error: 진도 저장 실패 시 재생을 막지 않고 `진도 저장을 다시 시도하고 있어요`를 표시한다.
- Success: 차시 완료 시 체크와 다음 차시 CTA를 즉시 갱신한다.
- Disabled: 만료 콘텐츠는 CTA를 비활성화하고 재구매/문의 경로를 제공한다.
- Offline/slow network: 마지막 저장 시각을 표시하고 재연결 시 진도를 재전송한다.

## Content voice
- Tone: 친근하지만 상태와 정책은 명확하게 표현한다.
- Terminology:
  - `구매 완료`와 `수강 완료`를 혼용하지 않는다.
  - `보유 중`, `수강 중`, `완료`, `만료 예정`, `만료`를 사용한다.
- Microcopy rules:
  - `12/32강 완료 · 38%`처럼 숫자와 다음 행동을 함께 보여준다.
  - `마지막 학습: 2장 4강 · 7월 12일`처럼 재개 맥락을 제공한다.
  - 미구매 상품은 `구매하기`, 구매 상품은 `입장/이어보기`를 사용한다.

## Implementation constraints
- Framework/styling system: Next.js 16 App Router, React 19.2, 현재 인라인 스타일 + `globals.css` 구조.
- Authentication: Supabase Auth 쿠키를 서버에서 `auth.getUser()`로 검증한다.
- Authorization source of truth: `entitlements`. 주문 상태나 로그인 여부만으로 접근을 허용하지 않는다.
- Recommended domain model:
  - `products`: 판매 단위. `course | ebook` 유형과 가격/활성 상태.
  - `entitlements`: 사용자별 상품 접근 권한과 만료 시각.
  - `courses`: 강의 메타데이터와 해당 판매 상품 연결.
  - `course_sections`: 챕터와 정렬 순서.
  - `lessons`: 차시, 영상 식별자, 재생 시간, 미리보기 여부.
  - `lesson_progress`: `user_id`, `lesson_id`, `last_position_seconds`, `completed_at`, `updated_at`.
  - `ebooks`: 전자책 메타데이터와 안전한 파일/리더 식별자.
  - `ebook_progress`: 인앱 리더를 제공할 때만 현재 페이지/진도 저장.
  - 묶음 상품이 필요해지면 `product_contents` 연결 테이블을 추가해 한 상품이 여러 강의/전자책을 부여하게 한다.
- Progress rule:
  - 영상의 90% 이상 재생 시 자동 완료를 기본 가정으로 한다.
  - 사용자가 수정할 수 있도록 `학습 완료` 토글을 제공할 수 있다.
  - 재생 위치는 약 10–15초 간격, 일시정지, 페이지 이탈 시 upsert한다.
  - 전체 진도율은 완료 차시와 부분 시청 위치를 합산하고, 완료 차시 수는 별도 지표로 유지한다.
- Security:
  - 강의실과 전자책은 서버에서 이용권을 확인한 뒤 접근시킨다.
  - 영상/파일 원본의 공개 URL을 DB나 HTML에 노출하지 않고 만료되는 signed URL을 사용한다.
  - 사용자는 RLS를 통해 본인 진도만 조회/수정할 수 있다.
- Performance constraints: 마이 클래스 첫 화면은 최근 학습 1건과 보유 콘텐츠 목록에 필요한 데이터만 조회한다.
- Compatibility constraints: 로그인 후 홈과 마이 클래스는 동일 호스트의 Supabase 쿠키를 사용한다.
- Test/screenshot expectations:
  - 비로그인/보유 없음/강의 1개/강의+전자책 다수/완료/만료 상태를 검증한다.
  - 차시 90% 재생, 수동 완료, 새로고침, 다른 기기 재로그인 후 진도 복원을 E2E로 검증한다.

## Open questions
- [ ] VOD 이용 기간이 정확히 365일인지 평생 소장인지 확정 / 상품 담당 / 만료 UI·DB 정책 영향.
- [ ] 차시 자동 완료 기준 90%와 수동 완료 허용 여부 확정 / 콘텐츠 운영 / 진도 신뢰성 영향.
- [ ] 전자책을 인앱 리더로 제공할지 PDF 다운로드로 제공할지 확정 / 상품 담당 / 진도 추적 가능 여부 영향.
- [ ] VOD 호스팅 제공자와 signed URL 방식 확정 / 개발 / 보안·비용·플레이어 구현 영향.
- [ ] 환불 시 이용권 즉시 회수 및 진도 보존 정책 확정 / 운영 / 고객지원 영향.
- [ ] 묶음 상품 출시 가능성 확정 / 상품 담당 / `product_contents` 도입 시점 영향.
