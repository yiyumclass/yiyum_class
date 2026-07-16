import "server-only";

import { requireAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";

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

export type AdminLearningProgressResult = {
  records: AdminLearningRecord[];
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
};

export async function loadAdminLearningProgress(): Promise<AdminLearningProgressResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_learning_progress");

  if (error) {
    const setupRequired =
      error.code === "42883" || error.code === "PGRST202" || error.code === "PGRST205";

    if (!setupRequired) {
      console.error("Failed to load admin learning progress:", error.message);
    }

    return {
      records: [],
      databaseReady: false,
      message: setupRequired
        ? "학습 현황 조회용 데이터베이스 설정이 아직 적용되지 않았습니다."
        : "학습 현황을 불러오지 못했습니다. 잠시 후 페이지를 새로고침해 주세요.",
    };
  }

  const rows = Array.isArray(data) ? (data as AdminLearningRow[]) : [];
  return {
    records: rows.map(mapLearningRow),
    databaseReady: true,
    message: null,
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
    totalLessons: Number(row.total_lessons),
    startedLessons: Number(row.started_lessons),
    completedLessons: Number(row.completed_lessons),
    watchedSeconds: Number(row.watched_seconds),
    progressPercent: Number(row.progress_percent),
    lastWatchedAt: row.last_watched_at,
    lastLessonKey: row.last_lesson_key,
    lastLessonTitle: row.last_lesson_title,
  };
}
