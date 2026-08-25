# SOLAPI 회원가입 환영 알림톡

카카오로 새 계정을 만든 직후 환영 알림톡을 한 번 요청한다. 메시지 발송 실패나
설정 누락은 가입을 막지 않으며, 기존 회원의 일반 로그인에는 발송하지 않는다.

## SOLAPI 준비

1. SOLAPI 콘솔에서 카카오 비즈니스 채널을 연동한다.
2. 치환 변수가 없는 환영 알림톡 템플릿을 등록하고 검수 승인을 받는다.
3. API Key, API Secret, PFID, 승인된 Template ID를 확인한다.

현재 구현은 문자 대체발송을 비활성화한다. 따라서 발신번호는 필요하지 않으며,
알림톡 템플릿에 치환 변수를 추가하려면 `src/lib/messaging/solapi.ts`의
`variables`도 승인된 템플릿과 정확히 맞춰야 한다.

## 환경 변수

로컬은 프로젝트 루트의 `.env.local`, 배포는 Vercel의 Production 환경 변수에
다음 값을 넣는다. 키와 시크릿에는 `NEXT_PUBLIC_` 접두사를 붙이지 않는다.

```dotenv
SOLAPI_API_KEY=
SOLAPI_API_SECRET=
SOLAPI_PF_ID=
SOLAPI_WELCOME_TEMPLATE_ID=
```

환경 변수를 바꾼 뒤에는 개발 서버를 재시작하거나 새 배포를 생성한다.

## 카카오 전화번호 제공 설정

카카오 디벨로퍼스의 카카오 로그인 동의항목에서 `phone_number` 제공 권한과
동의 단계를 설정해야 한다. Supabase의 카카오 사용자 메타데이터에 전화번호가
없으면 가입은 완료되지만 환영 알림톡은 건너뛴다. 국내 번호는 카카오의
`+82 10-1234-5678` 형식에서 SOLAPI의 `01012345678` 형식으로 변환한다.

## 동작 확인

1. 기존 연결 이력이 없는 카카오 계정으로 `/signup`에서 가입한다.
2. Vercel Runtime Logs에 `Skipped SOLAPI signup welcome message` 또는
   `Failed to send SOLAPI signup welcome message`가 없는지 확인한다.
3. SOLAPI 콘솔의 메시지 발송 내역에서 수신 성공 여부를 확인한다.

전화번호나 API 자격 증명은 애플리케이션 로그에 기록하지 않는다.
