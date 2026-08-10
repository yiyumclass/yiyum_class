"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { getMuxClient, isMuxUploadConfigured } from "@/lib/mux/client";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/safe-input";

export type DeleteContentResult = {
  ok: boolean;
  message: string;
  // 수강 기록이나 이용권 때문에 막힌 경우에만 true. 화면이 보관 처리를 바로 제안한다.
  canArchive?: boolean;
  // 수강 기록 때문에 막힌 경우에만 true. owner 라면 완전 삭제를 이어서 제안한다.
  canForceDelete?: boolean;
};

type DeleteRow = {
  deleted: boolean;
  reason: "ok" | "not_found" | "has_progress" | "has_entitlement";
  mux_asset_ids: string[] | null;
};

type ContentKind = "lesson" | "section" | "course";

const rpcByKind: Record<ContentKind, string> = {
  lesson: "delete_lesson_if_unused",
  section: "delete_course_section_if_unused",
  course: "delete_course_if_unused",
};

const paramByKind: Record<ContentKind, string> = {
  lesson: "target_lesson_id",
  section: "target_section_id",
  course: "target_course_id",
};

const labelByKind: Record<ContentKind, string> = {
  lesson: "차시",
  section: "챕터",
  course: "강의",
};

/**
 * 거부 사유를 그대로 보여주지 않고 다음 행동까지 알려준다.
 * "지울 수 없다"만 뜨면 운영자는 보관 처리라는 대안이 있다는 걸 모른다.
 */
function describeRejection(reason: DeleteRow["reason"], kind: ContentKind) {
  const label = labelByKind[kind];

  if (reason === "not_found") {
    return `삭제할 ${label}을(를) 찾지 못했습니다.`;
  }
  if (reason === "has_progress") {
    return `수강 기록이 있어 삭제할 수 없습니다. 상태를 보관으로 바꾸면 수강생 화면에서만 사라지고 기록은 남습니다.`;
  }
  if (reason === "has_entitlement") {
    return "이용권을 가진 회원이 있어 삭제할 수 없습니다. 상태를 보관으로 바꿔 주세요.";
  }
  return `${label}을(를) 삭제하지 못했습니다.`;
}

/**
 * Mux 자산 정리는 실패해도 되돌리지 않는다. DB 삭제는 이미 끝났고,
 * 남은 자산은 무료 한도만 차지할 뿐 화면에는 영향이 없다.
 */
async function removeMuxAssets(assetIds: string[]) {
  if (assetIds.length === 0 || !isMuxUploadConfigured()) return;

  const mux = getMuxClient();
  await Promise.all(
    assetIds.map(async (assetId) => {
      try {
        await mux.video.assets.delete(assetId);
      } catch (error) {
        console.error(
          "Failed to delete Mux asset after content removal:",
          error instanceof Error ? error.message : "unknown error"
        );
      }
    })
  );
}

async function deleteContent(
  kind: ContentKind,
  targetId: string
): Promise<DeleteContentResult> {
  await requireAdmin();

  if (!isUuid(targetId)) {
    return { ok: false, message: `삭제할 ${labelByKind[kind]}을(를) 확인해 주세요.` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(rpcByKind[kind], {
    [paramByKind[kind]]: targetId,
  });

  if (error) {
    console.error(`Failed to delete ${kind}:`, error.code);
    if (error.code === "42501") {
      return {
        ok: false,
        message:
          kind === "course"
            ? "강의 삭제는 최고 관리자만 할 수 있습니다."
            : "권한이 부족합니다.",
      };
    }
    if (
      error.code === "42883" ||
      error.code === "PGRST202" ||
      error.code === "PGRST205"
    ) {
      return { ok: false, message: "삭제 기능 설정이 아직 적용되지 않았습니다." };
    }
    return { ok: false, message: `${labelByKind[kind]}을(를) 삭제하지 못했습니다.` };
  }

  const row = (Array.isArray(data) ? data[0] : data) as DeleteRow | null;
  if (!row) {
    return { ok: false, message: `${labelByKind[kind]}을(를) 삭제하지 못했습니다.` };
  }
  if (!row.deleted) {
    return {
      ok: false,
      message: describeRejection(row.reason, kind),
      canArchive: row.reason === "has_progress" || row.reason === "has_entitlement",
      // 차시만 완전 삭제를 연다. 챕터·강의는 한 번에 지워지는 범위가 넓어
      // 같은 확인 절차로는 규모를 가늠할 수 없다.
      canForceDelete: kind === "lesson" && row.reason === "has_progress",
    };
  }

  await removeMuxAssets(row.mux_asset_ids ?? []);

  revalidatePath("/admin/courses");
  revalidatePath("/admin");
  return { ok: true, message: `${labelByKind[kind]}을(를) 삭제했습니다.` };
}

export async function deleteLessonAction(lessonId: string) {
  return deleteContent("lesson", lessonId);
}

export async function deleteCourseSectionAction(sectionId: string) {
  return deleteContent("section", sectionId);
}

export async function deleteCourseAction(courseId: string) {
  return deleteContent("course", courseId);
}

export type LessonDeletionImpact = {
  lessonTitle: string;
  courseSlug: string;
  hasVideo: boolean;
  watcherCount: number;
  completedCount: number;
};

type ImpactRow = {
  lesson_title: string;
  course_slug: string;
  has_video: boolean;
  watcher_count: number;
  completed_count: number;
};

/**
 * 완전 삭제를 묻기 전에 걸려 있는 수강 기록 규모를 읽는다.
 * 숫자를 보여 주지 않으면 운영자는 무엇을 지우는지 모르는 채로 누르게 된다.
 */
export async function getLessonDeletionImpactAction(
  lessonId: string
): Promise<LessonDeletionImpact | null> {
  await requireAdmin();

  if (!isUuid(lessonId)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lesson_deletion_impact", {
    target_lesson_id: lessonId,
  });

  if (error) {
    console.error("Failed to load lesson deletion impact:", error.code);
    return null;
  }

  const row = (Array.isArray(data) ? data[0] : data) as ImpactRow | undefined;
  if (!row) return null;

  return {
    lessonTitle: row.lesson_title,
    courseSlug: row.course_slug,
    hasVideo: row.has_video,
    watcherCount: row.watcher_count,
    completedCount: row.completed_count,
  };
}

/**
 * 수강 기록이 있어도 차시를 지운다. 커리큘럼에서 아예 걷어내는 경우를 위한 길이다.
 *
 * 수강 기록 자체는 지우지 않는다. lesson_progress 는 차시를 문자열로 참조하므로
 * 차시가 사라져도 행은 남고, 삭제 시 남긴 스냅샷으로 다시 읽을 수 있다.
 */
export async function forceDeleteLessonAction(
  lessonId: string
): Promise<DeleteContentResult> {
  await requireAdmin();

  if (!isUuid(lessonId)) {
    return { ok: false, message: "삭제할 차시를 확인해 주세요." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("force_delete_lesson", {
    target_lesson_id: lessonId,
  });

  if (error) {
    console.error("Failed to force delete lesson:", error.code);
    if (error.code === "42501") {
      return { ok: false, message: "완전 삭제는 최고 관리자만 할 수 있습니다." };
    }
    if (
      error.code === "42883" ||
      error.code === "PGRST202" ||
      error.code === "PGRST205"
    ) {
      return { ok: false, message: "완전 삭제 기능 설정이 아직 적용되지 않았습니다." };
    }
    return { ok: false, message: "차시를 삭제하지 못했습니다." };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | (DeleteRow & { watcher_count: number })
    | null;

  if (!row?.deleted) {
    return { ok: false, message: "삭제할 차시를 찾지 못했습니다." };
  }

  await removeMuxAssets(row.mux_asset_ids ?? []);

  revalidatePath("/admin/courses");
  revalidatePath("/admin");
  revalidatePath("/admin/progress");
  return {
    ok: true,
    message:
      row.watcher_count > 0
        ? `차시를 삭제했습니다. 수강 기록 ${row.watcher_count}건은 "삭제된 차시" 목록에서 계속 확인할 수 있습니다.`
        : "차시를 삭제했습니다.",
  };
}

const tableByKind: Record<ContentKind, string> = {
  lesson: "lessons",
  section: "course_sections",
  course: "courses",
};

/**
 * 삭제가 막혔을 때의 대안. 수강생 화면에서만 감추고 수강 기록은 그대로 둔다.
 * 상태 변경은 기존 수정 경로와 같은 표를 쓰므로 감사 로그도 그대로 남는다.
 */
export async function archiveContentAction(
  kind: ContentKind,
  targetId: string
): Promise<DeleteContentResult> {
  await requireAdmin();

  if (!isUuid(targetId)) {
    return { ok: false, message: `보관할 ${labelByKind[kind]}을(를) 확인해 주세요.` };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from(tableByKind[kind])
    .update({ status: "archived" })
    .eq("id", targetId);

  if (error) {
    console.error(`Failed to archive ${kind}:`, error.code);
    return { ok: false, message: `${labelByKind[kind]}을(를) 보관하지 못했습니다.` };
  }

  revalidatePath("/admin/courses");
  revalidatePath("/admin");
  return {
    ok: true,
    message: `${labelByKind[kind]}을(를) 보관 처리했습니다. 수강생 화면에서는 보이지 않습니다.`,
  };
}
