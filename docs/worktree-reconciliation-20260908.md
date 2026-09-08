# 2026-09-08 미반영 작업 통합 기록

기준: `origin/main` f2f449c. 전체 로컬/원격 브랜치, 6개 작업 폴더, 기존 stash를 비교했다.

## 반영

- 카카오 및 이메일 인증 결과 접속기록 수집. 이메일 로그인은 서버 액션에서 처리한다.
- 최고관리자 전용 `/admin/privacy`: 접속기록과 현재 탈퇴 처리 단계 조회.
- 기존 일일 cron에서 3개월 만료 접속기록 파기. 결제 설정과 독립 실행.
- 관리자 승격 SQL 회귀 테스트, 인증 실패/권한/cron 실행 테스트.
- 동의 쿠키 검증에서 미래 발급·비정상 토큰 거부.

## 선별 제외

- 구형 탈퇴 SQL, hard delete, 구형 보관자료 관리/파기 RPC: 현재 tombstone 흐름과 충돌한다.
  운영 탈퇴 마이그레이션을 과거 파일 수정으로 교체하지 않는다.
- OAuth `signup_intent` URL 복구 커밋 9ebfd29: 서명된 동의 토큰이 URL·로그에 실리고
  다른 인증 시도에서 재사용될 수 있으므로 그대로 이식하지 않는다. 현재 쿠키 기반 동의
  검증과 가입 미완료 안내를 유지한다. 쿠키 유실 자동 복구가 필요하면 인증 시도에 묶인
  일회성 서버 상태로 별도 구현해야 한다.
- 과거 약관·개인정보 문구와 CSS 초안: 현재 공개 문서/최신 디자인을 덮어쓰지 않는다.
- 결제 폴더의 기능 파일 6개: main과 동일. 테스트 차이는 main의 추가 회귀 검증을 유지한다.
- 카카오 폴더의 접속기록 SQL·owner 승격 SQL: main과 동일.
- 기존 stash: 운영 전 검수 커밋 27ddce9에서 반영되거나 후속 멤버십 구현으로 변경된 초안.

## 복구

삭제 전 모든 브랜치 끝점과 미커밋 파일은 로컬 Git 참조로 보관했다. 시크릿·환경 파일 등
gitignore 대상은 스냅샷에 넣지 않았다. 이 참조는 main으로 병합할 대상이 아니다.

- `refs/archive/20260908-reconciliation/branches/<원래 브랜치>`
- `refs/archive/20260908-reconciliation/workspaces/original`
- `refs/archive/20260908-reconciliation/workspaces/kakao`
- `refs/archive/20260908-reconciliation/workspaces/payment`
- `refs/archive/20260908-reconciliation/stash`

목록: `git for-each-ref refs/archive/20260908-reconciliation`

복원 예시: `git worktree add -b recovery-original /tmp/yiyume-recovery refs/archive/20260908-reconciliation/workspaces/original`

원본 저장소는 지우지 않는다. 삭제할 연결 작업 폴더의 무시된 로컬 파일은 별도 비공개
보관 폴더로 옮겨 복구 가능하게 유지한다. 작업 정리 결과와 위치는 최종 전달에 기록한다.
