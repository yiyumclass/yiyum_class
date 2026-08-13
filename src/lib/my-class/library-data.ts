import type { Course, CourseProgress } from "@/lib/learning/types";
import {
  calculateCourseProgressPercent,
  calculateLessonProgressPercent,
  getAvailableLessons,
} from "@/lib/learning/progress";
import type {
  ConsultingLibraryItem,
  CourseLibraryItem,
  EbookLibraryItem,
} from "@/lib/my-class/types";

type CourseLibraryDetails = {
  /** 판매 상품 주소. 같은 원본 강의를 여러 챕터 상품이 공유할 때 라우팅에 쓴다. */
  productSlug?: string;
  description?: string;
  accessLabel?: string;
  contentReady?: boolean;
};

type EbookLibraryDetails = {
  slug: string;
  title: string;
  description: string;
  accessLabel: string;
  /** 자료 파일이 올라와 있는지. 없으면 준비 중으로 둔다. */
  hasFile?: boolean;
  ctaLabel?: string;
};

export function buildCourseLibraryItem(
  course: Course,
  progress: CourseProgress,
  details: CourseLibraryDetails = {}
): CourseLibraryItem {
  const flatLessons = course.sections.flatMap((section, sectionIndex) =>
    section.lessons.map((lesson, lessonIndex) => ({
      ...lesson,
      sectionIndex,
      lessonIndex,
    })).filter((lesson) => lesson.availability !== "coming-soon")
  );
  const currentLesson =
    flatLessons.find((lesson) => lesson.id === progress.currentLessonId) ??
    flatLessons[0];
  const completedSet = new Set(progress.completedLessonIds);
  const completedLessons = flatLessons.filter((lesson) =>
    completedSet.has(lesson.id)
  );
  const completedCount = completedLessons.length;
  const totalLessons = getAvailableLessons(course).length;
  const contentReady = details.contentReady ?? totalLessons > 0;
  const percentage = calculateCourseProgressPercent(course, progress);
  const currentLessonProgress = currentLesson
    ? calculateLessonProgressPercent(
        currentLesson.durationSeconds,
        progress.positionsByLessonId[currentLesson.id] ?? 0,
        completedSet.has(currentLesson.id)
      )
    : 0;
  const status = resolveCourseStatus({
    contentReady,
    completedCount,
    lastWatchedAt: progress.lastWatchedAt,
    totalLessons,
  });
  const recentCompletedLesson = flatLessons.find(
    (lesson) => lesson.id === progress.lastCompletedLessonId
  );

  return {
    id: `${details.productSlug ?? course.slug}-course`,
    kind: "course",
    href: `/learn/${details.productSlug ?? course.slug}`,
    title: course.title,
    description: details.description || course.description,
    status,
    statusLabel: formatCourseStatusLabel(status),
    accessLabel: details.accessLabel || "이용 기간 확인 필요",
    lastActivity: formatLastActivity(progress.lastWatchedAt),
    lastActivityAt: progress.lastWatchedAt,
    ctaLabel: formatCourseCtaLabel(status),
    progress: percentage,
    completedLessons: completedCount,
    totalLessons,
    currentLessonLabel: currentLesson
      ? `${currentLesson.sectionIndex + 1}장 ${currentLesson.lessonIndex + 1}강 · ${currentLesson.title}`
      : "공개될 차시를 준비 중입니다",
    currentLessonProgress,
    recentCompletedLessonLabel: recentCompletedLesson?.title ?? null,
  };
}

type CourseStatusInput = {
  contentReady: boolean;
  completedCount: number;
  lastWatchedAt: string | null;
  totalLessons: number;
};

function resolveCourseStatus({
  contentReady,
  completedCount,
  lastWatchedAt,
  totalLessons,
}: CourseStatusInput): CourseLibraryItem["status"] {
  if (!contentReady) return "preparing";
  if (completedCount === totalLessons && totalLessons > 0) return "completed";
  if (lastWatchedAt || completedCount > 0) return "in-progress";
  return "not-started";
}

function formatCourseStatusLabel(status: CourseLibraryItem["status"]): string {
  switch (status) {
    case "preparing":
      return "강의 준비 중";
    case "completed":
      return "수강 완료";
    case "in-progress":
      return "수강 중";
    case "not-started":
      return "학습 전";
  }
}

function formatCourseCtaLabel(status: CourseLibraryItem["status"]): string {
  switch (status) {
    case "preparing":
      return "강의 준비 중";
    case "completed":
      return "다시 보기";
    case "in-progress":
      return "이어보기";
    case "not-started":
      return "VOD 강의실 입장";
  }
}

export function buildEbookLibraryItem(details: EbookLibraryDetails): EbookLibraryItem {
  const ready = details.hasFile === true;

  return {
    id: `${details.slug}-ebook`,
    kind: "ebook",
    slug: details.slug,
    title: details.title,
    description: details.description,
    status: ready ? "available" : "preparing",
    statusLabel: ready ? "내려받기 가능" : "파일 준비 중",
    accessLabel: details.accessLabel,
    lastActivity: "아직 열지 않음",
    lastActivityAt: null,
    ctaLabel: details.ctaLabel ?? (ready ? "자료 내려받기" : "자료 준비 중"),
  };
}

export type ConsultingLibraryDetails = {
  slug: string;
  title: string;
  description: string;
  accessLabel: string;
};

/**
 * 결제 직후 상태로 만든다. 컨설팅은 결제가 끝이 아니라 시작이라, 다음에 뭘
 * 해야 하는지 여기서 알려주지 않으면 결제하고 아무 일도 없는 것처럼 보인다.
 */
export function buildConsultingLibraryItem(
  details: ConsultingLibraryDetails
): ConsultingLibraryItem {
  return {
    id: `${details.slug}-consulting`,
    kind: "consulting",
    title: details.title,
    description: details.description,
    status: "available",
    statusLabel: "예약 안내 발송",
    accessLabel: details.accessLabel,
    lastActivity: "결제 완료",
    lastActivityAt: null,
    ctaLabel: "카카오톡 문의",
  };
}

function formatLastActivity(value: string | null) {
  if (!value) return "아직 시작하지 않음";

  const date = new Date(value);
  const now = new Date();
  const dateKey = formatDateKey(date);
  const todayKey = formatDateKey(now);
  const yesterdayKey = formatDateKey(new Date(now.getTime() - 86_400_000));

  if (dateKey === todayKey) return "오늘";
  if (dateKey === yesterdayKey) return "어제";

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatDateKey(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}
