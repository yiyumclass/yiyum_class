import type {
  Course,
  CourseLesson,
  CourseProgress,
} from "@/lib/learning/types";

const lesson = (
  id: string,
  title: string,
  durationSeconds: number,
  videoSrc?: string
): CourseLesson => ({ id, title, durationSeconds, videoSrc });

export const courses: Course[] = [
  {
    slug: "sns-monetization",
    title: "이윰 SNS 수익화 클래스",
    shortTitle: "SNS 수익화 클래스",
    description:
      "계정 세팅부터 콘텐츠, 알고리즘, 수익화와 브랜딩까지 작은 계정을 수익으로 연결하는 전 과정을 배웁니다.",
    instructor: "이윰",
    posterSrc: "/assets/profile.jpg",
    sections: [
      {
        id: "account-setup",
        title: "계정 세팅",
        description:
          "수익화에 유리한 계정의 방향을 정하고, 프로필과 랜딩페이지까지 기본 구조를 완성합니다.",
        lessons: [
          lesson(
            "sns-01",
            "크리에이터 카테고리 정복하기 — 진입장벽·시청자층·얼굴 노출",
            532,
            "/videos/sns-account-01.mp4"
          ),
          lesson("sns-02", "계정 정체성 잡는 법 — 한 계정에 여러 주제 올려도 되나요?", 711),
          lesson("sns-03", "수익화를 위한 프로필 4줄 세팅법", 624),
          lesson(
            "sns-04",
            "수익화 필수 랜딩페이지 만드는 법 · 올바른 사용법",
            723,
            "/videos/sns-account-04.mp4"
          ),
          lesson("sns-05", "계정 날아가지 않게 취해야 하는 조치 6가지", 688),
          lesson("sns-06", "SNS에서 마음껏 활동하려면 무조건 해야 하는 것", 557),
        ],
      },
      {
        id: "content-basics",
        title: "콘텐츠 제작 기본기",
        description:
          "숏폼을 기획하고 촬영·편집하기 전에 필요한 장비와 기본 설정을 차근차근 익힙니다.",
        lessons: [
          lesson("sns-07", "숏폼 & 릴스 트렌드 분석", 773),
          lesson("sns-08", "촬영 전 기본 세팅값 — 카메라 화질, 촬영 비율", 645),
          lesson("sns-09", "촬영 장비 소개 — 삼각대, 마이크", 528),
          lesson("sns-10", "편집 프로그램 — 자막·효과음·목소리 넣는 법", 1052),
        ],
      },
      {
        id: "algorithm",
        title: "알고리즘",
        description:
          "조회수에 영향을 주는 후킹과 소재 선정부터 게시 후 운영까지, 성장에 필요한 판단 기준을 정리합니다.",
        lessons: [
          lesson("sns-11", "알고리즘 타는 릴스의 비밀", 906),
          lesson("sns-12", "카테고리별 내적 욕망 자극하는 법", 758),
          lesson("sns-13", "떡상하는 릴스의 공통점", 834),
          lesson("sns-14", "빠르게 팔로워 늘리는 법", 695),
          lesson("sns-15", "알고리즘 부스터 켜는 사후 전략 7개", 967),
          lesson("sns-16", "초반 3초 후킹 생각하는 팁", 601),
          lesson("sns-17", "해시태그, 이렇게 쓰면 10년 뒤처진 겁니다", 543),
          lesson("sns-18", "콘텐츠 소재 무한대로 얻는 법", 788),
          lesson("sns-19", "광고 릴스 대본 써주는 최적화 프롬프트", 862),
          lesson("sns-20", "댓글 품앗이, 이렇게 하면 계정 나락 갑니다", 574),
        ],
      },
      {
        id: "monetization",
        title: "수익화 로드맵",
        description:
          "협찬을 찾고 제안하며 단가를 협상하는 과정을 실제 수익화 순서에 맞춰 살펴봅니다.",
        lessons: [
          lesson("sns-21", "수익화할 수 있는 10가지 루트", 1014),
          lesson("sns-22", "팔로워 수 상관없이 100% 수익화 가능한 방법 (100명대도 가능)", 799),
          lesson("sns-23", "구간별 협찬 로드맵 — 팔로워 몇 명부터 협찬이 들어올까?", 746),
          lesson("sns-24", "단가 협상 실전편 — 원고료 얼마 받을 수 있을까?", 923),
          lesson("sns-25", "광고 단가 10배 올리는 치트키 5가지", 812),
          lesson("sns-26", "브랜드가 무조건 답장하는 이메일·DM 템플릿", 879),
          lesson("sns-27", "체험단 사이트", 491),
          lesson("sns-28", "협찬 받는 루트", 637),
        ],
      },
      {
        id: "branding",
        title: "찐팬 · 브랜딩",
        description:
          "일회성 조회수를 넘어 오래 남는 팬과 브랜드를 만들고, 수익화 이후의 운영 기반을 준비합니다.",
        lessons: [
          lesson("sns-29", "정보성으로 모은 팔로워를 찐팬으로 전환시키는 테크트리", 948),
          lesson("sns-30", "얼굴 공개 없이 수익화 잘하는 크리에이터의 공통점", 721),
          lesson("sns-31", "세금 관리 · 세무사 추천", 684),
          lesson("sns-32", "멘탈 관리", 608),
        ],
      },
    ],
  },
];

export function getCourseBySlug(slug: string) {
  return courses.find((course) => course.slug === slug);
}

// TODO: lesson_progress 조회 결과로 교체한다.
// 카탈로그와 진도 데이터를 분리해 실제 저장소 연결 시 UI를 바꾸지 않도록 한다.
export const previewCourseProgress: Record<string, CourseProgress> = {
  "sns-monetization": {
    currentLessonId: "sns-04",
    completedLessonIds: Array.from(
      { length: 3 },
      (_, index) => `sns-${String(index + 1).padStart(2, "0")}`
    ),
    positionsByLessonId: {},
    lastWatchedAt: null,
    lastCompletedLessonId: "sns-03",
  },
};
