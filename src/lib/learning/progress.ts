import type { SupabaseClient } from "@supabase/supabase-js";
import type { Course, CourseProgress } from "@/lib/learning/types";

export type LessonProgressRow = {
  course_slug: string;
  lesson_id: string;
  last_position_seconds: number;
  duration_seconds: number;
  completed_at: string | null;
  last_watched_at: string;
  updated_at: string;
};

export type CourseProgressLoadResult = {
  progress: CourseProgress;
  available: boolean;
  errorCode?: string;
};

export async function loadCourseProgress(
  supabase: SupabaseClient,
  course: Course
): Promise<CourseProgressLoadResult> {
  const { data, error } = await supabase
    .from("lesson_progress")
    .select(
      "course_slug, lesson_id, last_position_seconds, duration_seconds, completed_at, last_watched_at, updated_at"
    )
    .eq("course_slug", course.slug)
    .order("last_watched_at", { ascending: false });

  if (error) {
    return {
      progress: createEmptyCourseProgress(course),
      available: false,
      errorCode: error.code,
    };
  }

  return {
    progress: deriveCourseProgress(course, (data ?? []) as LessonProgressRow[]),
    available: true,
  };
}

export function createEmptyCourseProgress(course: Course): CourseProgress {
  const firstAvailableLesson = getAvailableLessons(course)[0];
  return {
    currentLessonId: firstAvailableLesson?.id ?? "",
    completedLessonIds: [],
    positionsByLessonId: {},
    lastWatchedAt: null,
    lastCompletedLessonId: null,
  };
}

/**
 * 전체 강의 진도는 각 차시를 동일한 비중으로 계산한다.
 * 완료한 차시는 100%, 아직 완료하지 않은 차시는 마지막 재생 위치만큼 반영한다.
 */
export function calculateCourseProgressPercent(
  course: Course,
  progress: Pick<CourseProgress, "completedLessonIds" | "positionsByLessonId">
) {
  const lessons = getAvailableLessons(course);
  if (lessons.length === 0) return 0;

  const completedSet = new Set(progress.completedLessonIds);
  const watchedLessonUnits = lessons.reduce((total, lesson) => {
    if (completedSet.has(lesson.id)) return total + 1;

    const position = progress.positionsByLessonId[lesson.id] ?? 0;
    const watchedRatio = lesson.durationSeconds
      ? Math.min(1, Math.max(0, position / lesson.durationSeconds))
      : 0;

    return total + watchedRatio;
  }, 0);

  return roundProgressPercent((watchedLessonUnits / lessons.length) * 100);
}

export function calculateLessonProgressPercent(
  durationSeconds: number,
  positionSeconds: number,
  isComplete: boolean
) {
  if (isComplete) return 100;
  if (durationSeconds <= 0) return 0;

  return Math.min(
    99,
    Math.max(0, Math.floor((positionSeconds / durationSeconds) * 100))
  );
}

function roundProgressPercent(value: number) {
  if (value <= 0) return 0;
  if (value >= 100) return 100;

  // 전체 강의에서 첫 부분 시청도 0%로 사라지지 않도록 0.1% 단위로 표시한다.
  return Math.round(value * 10) / 10;
}

export function deriveCourseProgress(
  course: Course,
  rows: LessonProgressRow[]
): CourseProgress {
  const lessons = getAvailableLessons(course);
  const validLessonIds = new Set(lessons.map((lesson) => lesson.id));
  const validRows = rows
    .filter((row) => validLessonIds.has(row.lesson_id))
    .sort(
      (a, b) =>
        new Date(b.last_watched_at).getTime() -
        new Date(a.last_watched_at).getTime()
    );
  const completedLessonIds = validRows
    .filter((row) => row.completed_at !== null)
    .map((row) => row.lesson_id);
  const completedSet = new Set(completedLessonIds);
  const positionsByLessonId = Object.fromEntries(
    validRows.map((row) => [row.lesson_id, row.last_position_seconds])
  );
  const latestRow = validRows[0];

  let currentLessonId = lessons[0]?.id ?? "";
  if (latestRow) {
    if (!latestRow.completed_at) {
      currentLessonId = latestRow.lesson_id;
    } else {
      const latestIndex = lessons.findIndex(
        (lesson) => lesson.id === latestRow.lesson_id
      );
      const nextIncomplete = lessons
        .slice(latestIndex + 1)
        .find((lesson) => !completedSet.has(lesson.id));
      const firstIncomplete = lessons.find(
        (lesson) => !completedSet.has(lesson.id)
      );
      currentLessonId =
        nextIncomplete?.id ?? firstIncomplete?.id ?? latestRow.lesson_id;
    }
  }

  return {
    currentLessonId,
    completedLessonIds,
    positionsByLessonId,
    lastWatchedAt: latestRow?.last_watched_at ?? null,
    lastCompletedLessonId:
      validRows.find((row) => row.completed_at !== null)?.lesson_id ?? null,
  };
}

export function getAvailableLessons(course: Course) {
  return course.sections
    .flatMap((section) => section.lessons)
    .filter((lesson) => lesson.availability !== "coming-soon");
}
