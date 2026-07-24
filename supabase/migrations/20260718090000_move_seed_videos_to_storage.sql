-- 시드에서 public 정적 경로(/videos/*)로 연결했던 차시 영상을 Supabase 스토리지로 이전한다.
-- public/ 아래 파일은 인증 없이 URL 직접 접근이 가능해 유료 콘텐츠 보호가 불가능하다.
-- 사전 조건: course-videos 버킷에 아래 객체가 업로드되어 있어야 한다.
--   lessons/sns-01/sns-account-01.mp4
--   lessons/sns-04/sns-account-04.mp4

update public.lessons
set video_provider = 'supabase',
    video_path = 'lessons/sns-01/sns-account-01.mp4'
where lesson_key = 'sns-01'
  and video_path = '/videos/sns-account-01.mp4';

update public.lessons
set video_provider = 'supabase',
    video_path = 'lessons/sns-04/sns-account-04.mp4'
where lesson_key = 'sns-04'
  and video_path = '/videos/sns-account-04.mp4';
