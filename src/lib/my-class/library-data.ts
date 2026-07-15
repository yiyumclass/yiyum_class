import type { Course, CourseProgress } from "@/lib/learning/types";
import {
  calculateCourseProgressPercent,
  calculateLessonProgressPercent,
  getAvailableLessons,
} from "@/lib/learning/progress";
import type { CourseLibraryItem, EbookLibraryItem } from "@/lib/my-class/types";

type CourseLibraryDetails = {
  description?: string;
  accessLabel?: string;
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
  const percentage = calculateCourseProgressPercent(course, progress);
  const currentLessonProgress = currentLesson
    ? calculateLessonProgressPercent(
        currentLesson.durationSeconds,
        progress.positionsByLessonId[currentLesson.id] ?? 0,
        completedSet.has(currentLesson.id)
      )
    : 0;
  const status =
    completedCount === totalLessons && totalLessons > 0
      ? "completed"
      : progress.lastWatchedAt || completedCount > 0
        ? "in-progress"
        : "not-started";
  const recentCompletedLesson = flatLessons.find(
    (lesson) => lesson.id === progress.lastCompletedLessonId
  );

  return {
    id: `${course.slug}-course`,
    kind: "course",
    href: `/learn/${course.slug}`,
    title: course.title,
    description: details.description || course.description,
    status,
    statusLabel:
      status === "completed"
        ? "수강 완료"
        : status === "in-progress"
          ? "수강 중"
          : "학습 전",
    accessLabel: details.accessLabel || "이용 기간 확인 필요",
    lastActivity: formatLastActivity(progress.lastWatchedAt),
    lastActivityAt: progress.lastWatchedAt,
    ctaLabel:
      status === "completed"
        ? "다시 보기"
        : status === "in-progress"
          ? "이어보기"
          : "VOD 강의실 입장",
    progress: percentage,
    completedLessons: completedCount,
    totalLessons,
    currentLessonLabel: currentLesson
      ? `${currentLesson.sectionIndex + 1}장 ${currentLesson.lessonIndex + 1}강 · ${currentLesson.title}`
      : "첫 강의를 준비 중입니다",
    currentLessonProgress,
    recentCompletedLessonLabel: recentCompletedLesson?.title ?? null,
  };
}

export function buildEbookLibraryItem(): EbookLibraryItem {
  return {
    id: "small-account-ebook",
    kind: "ebook",
    title: "작은 계정을 수익으로 연결하는 법",
    description: "수익화 계정의 방향과 실행 순서를 한 권에 정리한 실전 워크북",
    status: "available",
    statusLabel: "보유 중",
    accessLabel: "무기한",
    lastActivity: "아직 열지 않음",
    lastActivityAt: null,
    ctaLabel: "전자책 보기",
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
