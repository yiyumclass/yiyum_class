-- 공개 판매 화면에서 수익을 보장하는 것으로 오해될 수 있는 표현을
-- 교육 내용과 강사의 과거 경험 중심 문구로 정리한다.
begin;

update public.products
set summary = '계정의 방향을 정하고 콘텐츠와 브랜드 협업 준비를 연결하는 방법'
where slug = 'sns-monetization';

update public.courses
set description = '계정 세팅부터 콘텐츠, 알고리즘, 브랜드 협업 준비와 브랜딩까지 계정을 체계적으로 운영하는 전 과정을 배웁니다.'
where slug = 'sns-monetization';

update public.course_sections as section
set description = copy.description
from public.courses as course,
  (
    values
      (
        'account-setup',
        '브랜드 협업을 준비할 수 있도록 계정의 방향을 정하고, 프로필과 랜딩페이지까지 기본 구조를 완성합니다.'
      ),
      (
        'monetization',
        '브랜드 협업을 찾고 제안하며 조건을 검토·협상하는 과정을 강사의 실제 경험과 함께 살펴봅니다.'
      ),
      (
        'branding',
        '일회성 조회수를 넘어 오래 남는 팬과 브랜드를 만들고, 브랜드 협업 이후의 운영 기반을 준비합니다.'
      )
  ) as copy(section_key, description)
where section.course_id = course.id
  and course.slug = 'sns-monetization'
  and section.section_key = copy.section_key;

update public.lessons as lesson
set title = copy.title
from public.course_sections as section,
  public.courses as course,
  (
    values
      ('sns-03', '브랜드 협업을 준비하는 프로필 4줄 세팅법'),
      ('sns-04', '목적에 맞는 랜딩페이지 만드는 법 · 올바른 사용법'),
      ('sns-21', '크리에이터가 검토할 수 있는 10가지 수익화 방식'),
      ('sns-22', '팔로워 규모별로 검토할 수익화 방식과 선택 기준'),
      ('sns-23', '브랜드 협업 준비 로드맵 — 팔로워 규모별 점검 항목'),
      ('sns-24', '단가 협상 실전편 — 제작 범위와 원고료 검토 기준'),
      ('sns-25', '광고 단가 협상 전에 확인할 5가지 기준'),
      ('sns-26', '브랜드 이메일·DM 제안서 작성 템플릿'),
      ('sns-30', '얼굴 공개 없이 운영하는 크리에이터의 콘텐츠 공통점')
  ) as copy(lesson_key, title)
where lesson.section_id = section.id
  and section.course_id = course.id
  and course.slug = 'sns-monetization'
  and lesson.lesson_key = copy.lesson_key;

commit;
