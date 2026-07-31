import "server-only";

import { requireAdmin } from "@/lib/admin/auth";
import { ADMIN_EXPORT_LIMIT, isSetupError } from "@/lib/admin/list-params";
import { createClient } from "@/lib/supabase/server";

export const ADMIN_LEARNING_STATUSES = [
  "all",
  "not_started",
  "in_progress",
  "completed",
  "attention",
] as const;
export type AdminLearningStatus = (typeof ADMIN_LEARNING_STATUSES)[number];

export const ADMIN_LEARNING_SORTS = [
  "recent",
  "oldest",
  "progress_low",
  "progress_high",
  "lesson_low",
  "lesson_high",
  "name",
] as const;
export type AdminLearningSort = (typeof ADMIN_LEARNING_SORTS)[number];

export type AdminLearningQuery = {
  search: string | null;
  status: AdminLearningStatus;
  /** 강의 UUID. readUuid가 걸러 낸 값이라 UUID가 아니면 null이다. */
  courseId: string | null;
  sort: AdminLearningSort;
  limit: number;
  offset: number;
};

export type AdminLearningRecord = {
  memberId: string;
  memberEmail: string;
  memberName: string;
  entitlementId: string;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  totalLessons: number;
  startedLessons: number;
  completedLessons: number;
  watchedSeconds: number;
  progressPercent: number;
  lastWatchedAt: string | null;
  lastLessonKey: string | null;
  lastLessonTitle: string | null;
};

export type AdminLearningSummary = {
  memberCount: number;
  activeMemberCount: number;
  averageProgress: number;
  /** 필터와 무관한 전체 기준. 화면에서도 "전체 기준"이라고 밝히고 쓴다. */
  attentionTotal: number;
};

export type AdminLearningCourseSummary = {
  id: string;
  title: string;
  enrolled: number;
  inProgress: number;
  completed: number;
  recent: number;
  attention: number;
  averageProgress: number;
};

export type AdminLearningResult = {
  records: AdminLearningRecord[];
  totalCount: number;
  summary: AdminLearningSummary;
  courses: AdminLearningCourseSummary[];
  databaseReady: boolean;
  message: string | null;
};

type AdminLearningRow = {
  member_id: string;
  member_email: string;
  member_name: string;
  entitlement_id: string;
  course_id: string;
  course_slug: string;
  course_title: string;
  total_lessons: number;
  started_lessons: number;
  completed_lessons: number;
  watched_seconds: number;
  progress_percent: number | string;
  last_watched_at: string | null;
  last_lesson_key: string | null;
  last_lesson_title: string | null;
  total_count: number;
};

type AdminLearningSummaryRow = {
  member_count: number;
  active_member_count: number;
  average_progress: number | string;
  attention_total: number;
};

type AdminLearningCourseRow = {
  course_id: string;
  course_title: string;
  enrolled: number;
  in_progress: number;
  completed: number;
  recent: number;
  attention: number;
  average_progress: number | string;
};

const emptySummary: AdminLearningSummary = {
  memberCount: 0,
  activeMemberCount: 0,
  averageProgress: 0,
  attentionTotal: 0,
};

/**
 * 목록 한 페이지와 요약, 강의별 집계를 함께 읽는다.
 *
 * 이전에는 전량을 받아 브라우저에서 걸렀다. 렌더 비용만 줄고 전송량은 그대로라
 * 수강권이 쌓이면 이 화면부터 느려진다. 이제 거르기·정렬·자르기를 SQL이 한다.
 *
 * 요약을 따로 받는 이유는, 보이는 25행만으로 집계하면 "평균 현재 진도"가 페이지를
 * 넘길 때마다 달라져 학습 상황을 오독하게 되기 때문이다.
 *
 * 강의별 집계는 강의 필터를 빼고 부른다. 강의를 고른 뒤에도 카드 목록이 남아야
 * 다른 강의로 옮겨 갈 수 있다.
 */
export async function loadAdminLearningPage(
  query: AdminLearningQuery
): Promise<AdminLearningResult> {
  await requireAdmin();
  const supabase = await createClient();

  const [pageResult, summaryResult, courseResult] = await Promise.all([
    supabase.rpc("get_admin_learning_progress_page", {
      p_search: query.search,
      p_status: query.status,
      p_course_id: query.courseId,
      p_sort: query.sort,
      p_limit: query.limit,
      p_offset: query.offset,
    }),
    supabase.rpc("get_admin_learning_summary", {
      p_search: query.search,
      p_status: query.status,
      p_course_id: query.courseId,
    }),
    supabase.rpc("get_admin_learning_course_summary", {
      p_search: query.search,
      p_status: query.status,
    }),
  ]);

  const failure = pageResult.error ?? summaryResult.error ?? courseResult.error;
  if (failure) {
    const setupRequired = isSetupError(failure.code);
    if (!setupRequired) {
      console.error("Failed to load admin learning progress:", failure.message);
    }

    return {
      records: [],
      totalCount: 0,
      summary: emptySummary,
      courses: [],
      databaseReady: false,
      message: setupRequired
        ? "학습 현황 조회용 데이터베이스 설정이 아직 적용되지 않았습니다."
        : "학습 현황을 불러오지 못했습니다. 잠시 후 페이지를 새로고침해 주세요.",
    };
  }

  const rows = Array.isArray(pageResult.data) ? (pageResult.data as AdminLearningRow[]) : [];
  const summaryRow = (
    Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data
  ) as AdminLearningSummaryRow | null;
  const courseRows = Array.isArray(courseResult.data)
    ? (courseResult.data as AdminLearningCourseRow[])
    : [];

  return {
    records: rows.map(mapLearningRow),
    totalCount: Number(rows[0]?.total_count ?? 0),
    summary: summaryRow
      ? {
          memberCount: Number(summaryRow.member_count ?? 0),
          activeMemberCount: Number(summaryRow.active_member_count ?? 0),
          averageProgress: Number(summaryRow.average_progress ?? 0),
          attentionTotal: Number(summaryRow.attention_total ?? 0),
        }
      : emptySummary,
    courses: courseRows.map(mapCourseRow),
    databaseReady: true,
    message: null,
  };
}

/**
 * CSV용. 화면에 걸린 필터 그대로의 전체를 읽되 상한을 둔다.
 * 상한에 걸리면 화면이 "일부만 내려받았다"고 알려야 한다.
 */
export async function loadAdminLearningForExport(
  query: Omit<AdminLearningQuery, "limit" | "offset">
): Promise<{ records: AdminLearningRecord[]; truncated: boolean }> {
  await requireAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_admin_learning_progress_page", {
    p_search: query.search,
    p_status: query.status,
    p_course_id: query.courseId,
    p_sort: query.sort,
    p_limit: ADMIN_EXPORT_LIMIT,
    p_offset: 0,
  });

  if (error) {
    console.error("Failed to export admin learning progress:", error.message);
    return { records: [], truncated: false };
  }

  const rows = Array.isArray(data) ? (data as AdminLearningRow[]) : [];
  return {
    records: rows.map(mapLearningRow),
    truncated: Number(rows[0]?.total_count ?? 0) > rows.length,
  };
}

function mapLearningRow(row: AdminLearningRow): AdminLearningRecord {
  return {
    memberId: row.member_id,
    memberEmail: row.member_email,
    memberName: row.member_name,
    entitlementId: row.entitlement_id,
    courseId: row.course_id,
    courseSlug: row.course_slug,
    courseTitle: row.course_title,
    totalLessons: Number(row.total_lessons ?? 0),
    startedLessons: Number(row.started_lessons ?? 0),
    completedLessons: Number(row.completed_lessons ?? 0),
    watchedSeconds: Number(row.watched_seconds ?? 0),
    progressPercent: Number(row.progress_percent ?? 0),
    lastWatchedAt: row.last_watched_at,
    lastLessonKey: row.last_lesson_key,
    lastLessonTitle: row.last_lesson_title,
  };
}

function mapCourseRow(row: AdminLearningCourseRow): AdminLearningCourseSummary {
  return {
    id: row.course_id,
    title: row.course_title,
    enrolled: Number(row.enrolled ?? 0),
    inProgress: Number(row.in_progress ?? 0),
    completed: Number(row.completed ?? 0),
    recent: Number(row.recent ?? 0),
    attention: Number(row.attention ?? 0),
    averageProgress: Number(row.average_progress ?? 0),
  };
}
