# 영상 재생과 CSP

## 보안 정책의 범위

`src/lib/http/content-security-policy.ts`는 Mux Player와 Next.js가 함께 동작하도록 다음 정책을 적용한다.

- `script-src`: 요청별 nonce와 `strict-dynamic` 유지. 운영에서는 인라인 스크립트와 `eval`을 허용하지 않는다.
- `style-src`: Mux Player 3.13.2와 내부 Media Chrome 컴포넌트가 Shadow DOM에 생성하는 nonce 없는 `<style>`을 위해 `unsafe-inline`을 허용한다. 이 예외는 Mux 스타일만 구분하는 것이 아니라 문서 내 인라인 CSS 전체에 적용된다. 외부 스타일 출처는 기존 목록을 유지한다.
- `style-src`에 nonce 또는 해시를 함께 넣으면 `unsafe-inline`이 무시되어 플레이어가 다시 깨질 수 있으므로 혼합하지 않는다. 스크립트 nonce와는 별개다.
- `media-src`: `https://*.mux.com`을 허용한다. iOS/Safari의 네이티브 HLS는 `stream.mux.com`뿐 아니라 지역별 매니페스트·세그먼트 CDN 하위 도메인을 직접 사용한다.
- `connect-src`의 Mux 허용과 `worker-src`의 `blob:`은 기존대로 유지한다. 영상 출처를 `*` 또는 모든 HTTPS로 넓히지 않는다.

스타일 허용에는 CSS 주입 방어가 완화되는 절충이 있다. HTML을 임의로 삽입하거나 SDK 내부 DOM에 nonce를 자동 부착하는 우회 코드는 추가하지 않는다. Mux가 nonce를 정식 지원하면 스타일 정책을 다시 강화할 수 있다. 정책을 강의 URL에만 다르게 적용하면 Next.js 클라이언트 이동 시 최초 문서의 CSP가 남을 수 있어 문서 전체에서 일관된 정책을 사용한다.

이 변경은 로그인·수강권 검사, 서명 토큰, 결제 및 환불 로직을 변경하지 않는다. CSP에서 영상 출처를 허용해도 비회원이 서명 토큰 없이 유료 영상을 재생할 수 있는 것은 아니다.

참고: [Mux 공식 CSP 가이드](https://www.mux.com/docs/core/content-security-policy), [Media Chrome 스타일 CSP 이슈](https://github.com/muxinc/media-chrome/issues/898).

## 회귀 검증

```sh
node --no-warnings --experimental-strip-types --test tests/http-security.test.ts
npm test
npx tsc --noEmit
npx eslint src/lib/http/content-security-policy.ts tests/http-security.test.ts
npm run build
```

브라우저에서는 Chrome의 MSE 재생과 모바일 WebKit의 네이티브 HLS를 모두 확인한다. 서버의 재생 API가 200이라는 것만으로 재생 성공을 판단하지 않는다.

1. 현재 설치된 Mux Player와 실제 정책 생성 함수를 사용하는 격리 페이지 또는 관리자 미리보기를 사용한다. 고객 계정의 진도를 변경하지 않는다.
2. 재생 버튼을 누른 뒤 `playing`, 증가하는 `currentTime`, `readyState >= 3`을 확인한다.
3. 일시정지·재개, 탐색, 차시 전환 후 재생을 확인한다.
4. `securitypolicyviolation`에서 `style-src-elem`, `media-src`, `connect-src` 위반이 없는지 확인한다.
5. 반대로 nonce 없는 스크립트와 Mux가 아닌 외부 영상은 차단되는지 확인한다.
6. 배포 후에는 실제 아이폰 Safari·카카오 인앱과 안드로이드 Chrome에서 재확인한다. 모의 WebKit 검증은 고객 실기기 검증을 대신하지 않는다.

로컬 HTTP 격리 페이지에서 WebKit을 검증할 때는 `upgrade-insecure-requests` 때문에 로컬 스크립트가 HTTPS로 바뀌지 않도록 HTTPS 서버를 사용한다. 테스트 편의를 위해 운영 보안 정책에서 이 지시자를 제거하지 않는다.

## 2026-10-04 검증 결과

운영 DB는 변경하지 않고 계정 세팅 1·2차시의 서명된 스트림을 로컬 HTTPS 격리 페이지에서 재생했다. 페이지는 설치된 Mux Player 3.13.2와 수정한 CSP 생성 함수를 사용하며 진도를 저장하지 않는다.

| 환경 | 첫 영상 재생·일시정지·재개·30초 탐색 | 두 번째 영상으로 전환 | 재생 중 CSP 위반 |
| --- | --- | --- | --- |
| 데스크톱 Chrome | 통과 | 통과 | 0 |
| Pixel 7 모의 Chrome | 통과 | 통과 | 0 |
| iPhone 13 모의 WebKit | 통과 | 통과 | 0 |

- 기존 정책을 적용한 대조군은 WebKit에서 `style-src-elem`과 `media-src` 차단을 재현했고 재생 시간이 0초에 머물렀다.
- 세 환경 모두 HTML에 삽입한 nonce 없는 스크립트와 허용하지 않은 외부 영상이 차단됐다.
- 서명 없는 유료 Mux 스트림은 403, 로컬 운영용 Next 빌드의 비로그인 영상 API는 401이었다.
- 단위 테스트 162개, TypeScript, 변경 파일 ESLint, 운영용 빌드, diff 공백 검사를 통과했다. Next 빌드 응답에 수정한 CSP가 적용되는 것도 확인했다.
- 기존 미커밋 결제 작업 20개 파일은 수정 전후 SHA-256이 동일하다.
- 실제 고객 기기·로그인 강의실 전체 흐름의 배포 후 검증, 커밋, 푸시 및 운영 배포는 이 검증에 포함하지 않는다.
