"use server";

import { requireAdmin } from "@/lib/admin/auth";
import {
  ADMIN_LEARNING_SORTS,
  ADMIN_LEARNING_STATUSES,
  loadAdminLearningForExport,
  type AdminLearningRecord,
} from "@/lib/admin/learning-progress";
import { isUuid } from "@/lib/validation/safe-input";

/**
 * CSV 내보내기.
 *
 * 목록을 서버에서 자르게 되면서 화면에는 한 페이지밖에 없다. 필터에 걸린 전체를
 * 내보내려면 서버가 다시 읽어 줘야 한다.
 *
 * 인자는 클라이언트에서 오므로 신뢰하지 않는다. 허용값 상수로 다시 좁혀서 넘긴다.
 */
export async function exportAdminLearningAction(query: {
  search?: string | null;
  status?: string | null;
  courseId?: string | null;
  sort?: string | null;
}): Promise<{ rows: AdminLearningRecord[]; truncated: boolean }> {
  await requireAdmin();

  const search = typeof query.search === "string" ? query.search.trim() : "";
  const status = ADMIN_LEARNING_STATUSES.find((value) => value === query.status) ?? "all";
  const sort = ADMIN_LEARNING_SORTS.find((value) => value === query.sort) ?? "recent";
  const courseId =
    typeof query.courseId === "string" && isUuid(query.courseId) ? query.courseId : null;

  const { records, truncated } = await loadAdminLearningForExport({
    search: search.length > 0 ? search : null,
    status,
    courseId,
    sort,
  });

  return { rows: records, truncated };
}
