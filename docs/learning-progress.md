# VOD 진도 저장

## 저장 항목

`public.lesson_progress`는 사용자·강의·차시 조합마다 한 행을 유지한다.

- `last_position_seconds`: 마지막 재생 위치
- `duration_seconds`: 저장 시 확인한 영상 길이
- `completed_at`: 90% 이상 시청 또는 수동 완료 시각
- `last_watched_at`: 마이 클래스의 최근 학습 선정 기준
- `updated_at`: 마지막 DB 변경 시각

## 저장 시점

- 재생 위치가 직전 저장 위치에서 15초 이상 달라졌을 때
- 영상 일시정지
- 차시 이동
- 탭이 백그라운드로 전환되거나 페이지가 종료될 때
- 90% 이상 시청 또는 영상 종료
- 사용자가 완료 상태를 직접 변경할 때

저장 실패는 영상 재생을 막지 않는다. 화면에는 재시도 안내를 표시하고 다음 저장 시점에 다시 요청한다.

## 보안

- Route Handler가 Supabase 세션으로 사용자를 다시 확인한다.
- 서버의 강의 카탈로그에 존재하는 `courseSlug`와 `lessonId`만 허용한다.
- RLS가 `auth.uid() = user_id`인 행의 조회·추가·수정만 허용한다.
- `anon` 역할에는 테이블 권한을 부여하지 않는다.
- 다른 사용자의 진도는 조회하거나 변경할 수 없다.

## 원격 DB 적용

마이그레이션 파일:

`supabase/migrations/20260713090000_create_lesson_progress.sql`

프로젝트 관리자 계정으로 CLI에 로그인한 뒤 적용한다.

```bash
supabase login
supabase link --project-ref iipxllprppkzjovgfejb
supabase db push
```

또는 Supabase Dashboard의 SQL Editor에서 마이그레이션 파일 전체를 실행한다.

## 적용 확인

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename = 'lesson_progress';

select policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename = 'lesson_progress'
order by policyname;
```

기대 결과는 RLS 활성화와 `SELECT`, `INSERT`, `UPDATE` 정책 3개다.

## 운영 전 추가 항목

- `entitlements`를 연결해 유효한 구매자만 강의실 접근 허용
- 공개 `public/videos` 대신 VOD 저장소의 만료형 signed URL 사용
- 네트워크 장기 장애를 위한 로컬 재시도 큐 도입
