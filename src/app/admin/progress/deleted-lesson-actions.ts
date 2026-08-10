"use server";

import {
  loadDeletedLessonWatchers,
  type DeletedLessonWatcher,
} from "@/lib/admin/deleted-lessons";
import { isUuid } from "@/lib/validation/safe-input";

/**
 * 삭제된 차시의 회원별 기록. 목록을 펼칠 때만 읽는다.
 * 차시 하나에 수강생이 수백 명일 수 있어 처음부터 전부 실어 보내지 않는다.
 */
export async function loadDeletedLessonWatchersAction(
  recordId: string
): Promise<DeletedLessonWatcher[]> {
  if (!isUuid(recordId)) return [];
  return loadDeletedLessonWatchers(recordId);
}
