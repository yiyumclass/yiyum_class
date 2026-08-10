import "server-only";

import { requireAdmin } from "@/lib/admin/auth";
import { isSetupError } from "@/lib/admin/list-params";
import { createClient } from "@/lib/supabase/server";

/**
 * 삭제된 차시와, 그 차시에 남아 있는 수강 기록.
 *
 * 차시를 지워도 lesson_progress 행은 남지만, 진도 화면이 lessons 표를 기준으로
 * 만들어져서 화면에서는 보이지 않게 된다. 삭제 시 남긴 스냅샷을 열쇠 삼아
 * 그 기록을 다시 읽는다.
 */
export type DeletedLessonRecord = {
  id: string;
  courseSlug: string;
  courseTitle: string;
  sectionTitle: string | null;
  lessonKey: string;
  lessonTitle: string;
  durationSeconds: number;
  hadVideo: boolean;
  /** 삭제 시점의 시청자 수. 이후 값과 견주면 기록이 늘었는지 알 수 있다. */
  watcherCountAtDeletion: number;
  /** 지금 남아 있는 수강 기록 수. */
  recordCount: number;
  completedCount: number;
  watchedSeconds: number;
  lastWatchedAt: string | null;
  deletedAt: string;
  deletedByEmail: string;
};

export type DeletedLessonWatcher = {
  memberId: string;
  memberEmail: string;
  memberName: string;
  maxPositionSeconds: number;
  durationSeconds: number;
  firstCompletedAt: string | null;
  firstWatchedAt: string | null;
  lastWatchedAt: string | null;
};

export type DeletedLessonResult = {
  records: DeletedLessonRecord[];
  totalCount: number;
  databaseReady: boolean;
  message: string | null;
};

type RecordRow = {
  id: string;
  course_slug: string;
  course_title: string;
  section_title: string | null;
  lesson_key: string;
  lesson_title: string;
  duration_seconds: number;
  had_video: boolean;
  watcher_count_at_deletion: number;
  record_count: number;
  completed_count: number;
  watched_seconds: number;
  last_watched_at: string | null;
  deleted_at: string;
  deleted_by_email: string;
  total_count: number;
};

type WatcherRow = {
  member_id: string;
  member_email: string;
  member_name: string;
  max_position_seconds: number;
  duration_seconds: number;
  first_completed_at: string | null;
  first_watched_at: string | null;
  last_watched_at: string | null;
};

const DEFAULT_LIMIT = 50;

export async function loadDeletedLessons(options?: {
  search?: string | null;
  limit?: number;
  offset?: number;
}): Promise<DeletedLessonResult> {
  await requireAdmin();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_deleted_lesson_records", {
    p_search: options?.search?.trim() || null,
    p_limit: options?.limit ?? DEFAULT_LIMIT,
    p_offset: options?.offset ?? 0,
  });

  if (error) {
    // 마이그레이션 전이라면 화면을 깨뜨리지 않고 안내만 남긴다.
    if (isSetupError(error.code)) {
      return {
        records: [],
        totalCount: 0,
        databaseReady: false,
        message: "삭제된 차시 기록 기능이 아직 적용되지 않았습니다.",
      };
    }
    console.error("Failed to load deleted lessons:", error.code);
    return {
      records: [],
      totalCount: 0,
      databaseReady: true,
      message: "삭제된 차시 기록을 불러오지 못했습니다.",
    };
  }

  const rows = (data ?? []) as RecordRow[];

  return {
    records: rows.map(toRecord),
    totalCount: rows[0]?.total_count ?? 0,
    databaseReady: true,
    message: null,
  };
}

export async function loadDeletedLessonWatchers(
  recordId: string
): Promise<DeletedLessonWatcher[]> {
  await requireAdmin();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_deleted_lesson_watchers", {
    p_record_id: recordId,
  });

  if (error) {
    console.error("Failed to load deleted lesson watchers:", error.code);
    return [];
  }

  return ((data ?? []) as WatcherRow[]).map((row) => ({
    memberId: row.member_id,
    memberEmail: row.member_email,
    memberName: row.member_name,
    maxPositionSeconds: row.max_position_seconds,
    durationSeconds: row.duration_seconds,
    firstCompletedAt: row.first_completed_at,
    firstWatchedAt: row.first_watched_at,
    lastWatchedAt: row.last_watched_at,
  }));
}

function toRecord(row: RecordRow): DeletedLessonRecord {
  return {
    id: row.id,
    courseSlug: row.course_slug,
    courseTitle: row.course_title,
    sectionTitle: row.section_title,
    lessonKey: row.lesson_key,
    lessonTitle: row.lesson_title,
    durationSeconds: row.duration_seconds,
    hadVideo: row.had_video,
    watcherCountAtDeletion: row.watcher_count_at_deletion,
    recordCount: row.record_count,
    completedCount: row.completed_count,
    watchedSeconds: row.watched_seconds,
    lastWatchedAt: row.last_watched_at,
    deletedAt: row.deleted_at,
    deletedByEmail: row.deleted_by_email,
  };
}
