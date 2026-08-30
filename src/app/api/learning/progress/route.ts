import { hasActiveAdminAccess } from "@/lib/admin/access";
import { isSameOriginRequest } from "@/lib/http/origin";
import { readLimitedJson } from "@/lib/http/request-body";
import { hasActiveCourseAccess } from "@/lib/store/entitlements";
import {
  loadMyCourseByContentSlug,
  loadPublicCourseBySlug,
} from "@/lib/store/public-course-catalog";
import { getVerifiedIdentity } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

type CompletionAction = "preserve" | "complete" | "incomplete";

type ProgressPayload = {
  courseSlug?: unknown;
  lessonId?: unknown;
  positionSeconds?: unknown;
  durationSeconds?: unknown;
  completionAction?: unknown;
};

const PROGRESS_BODY_LIMIT_BYTES = 4 * 1024;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return json({ error: "요청 출처를 확인하지 못했습니다." }, 403);
  }

  const supabase = await createClient();
  const identity = await getVerifiedIdentity(supabase);

  if (!identity) {
    return json({ error: "로그인이 필요합니다." }, 401);
  }

  const parsed = await readLimitedJson(request, {
    limitBytes: PROGRESS_BODY_LIMIT_BYTES,
  });
  if (!parsed.ok || !isRecord(parsed.value)) {
    return json({ error: "올바른 요청 형식이 아닙니다." }, 400);
  }
  const payload = parsed.value as ProgressPayload;

  if (
    typeof payload.courseSlug !== "string" ||
    typeof payload.lessonId !== "string" ||
    typeof payload.positionSeconds !== "number" ||
    typeof payload.durationSeconds !== "number" ||
    !isCompletionAction(payload.completionAction)
  ) {
    return json({ error: "진도 정보가 올바르지 않습니다." }, 400);
  }

  const [isAdmin, hasCourseAccess] = await Promise.all([
    hasActiveAdminAccess(supabase, identity.userId),
    hasActiveCourseAccess(supabase, payload.courseSlug),
  ]);
  if (!isAdmin && !hasCourseAccess) {
    return json({ error: "수강 신청이 필요한 강의입니다." }, 403);
  }

  const catalogItem =
    !isAdmin && hasCourseAccess
      ? await loadMyCourseByContentSlug(
          supabase,
          payload.courseSlug,
          payload.lessonId
        )
      : await loadPublicCourseBySlug(payload.courseSlug);

  const course = catalogItem?.contentReady
    ? catalogItem.classroomCourse ?? undefined
    : undefined;
  const lesson = course?.sections
    .flatMap((section) => section.lessons)
    .find(
      (item) =>
        item.id === payload.lessonId && item.availability !== "coming-soon"
    );

  if (!course || !lesson) {
    return json({ error: "존재하지 않는 강의 또는 차시입니다." }, 404);
  }

  if (
    !Number.isFinite(payload.positionSeconds) ||
    !Number.isFinite(payload.durationSeconds) ||
    payload.positionSeconds < 0 ||
    payload.durationSeconds < 0
  ) {
    return json({ error: "재생 시간이 올바르지 않습니다." }, 400);
  }

  const durationSeconds = Math.max(
    0,
    Math.round(
      Math.min(
        payload.durationSeconds || lesson.durationSeconds,
        lesson.durationSeconds + 5
      )
    )
  );
  const positionSeconds = Math.max(
    0,
    Math.round(Math.min(payload.positionSeconds, durationSeconds || 0))
  );
  const { data: savedAt, error } = await supabase.rpc("save_my_lesson_progress", {
    target_course_slug: course.slug,
    target_lesson_id: lesson.id,
    target_position_seconds: positionSeconds,
    target_duration_seconds: durationSeconds,
    target_completion_action: payload.completionAction,
  });

  if (error) {
    console.error("Failed to save lesson progress", {
      code: error.code,
      lessonId: lesson.id,
      userId: identity.userId,
    });
    return json(
      {
        error: "진도 저장에 실패했습니다.",
        code: error.code === "PGRST205" ? "STORAGE_NOT_READY" : "SAVE_FAILED",
      },
      503
    );
  }

  return json({ ok: true, savedAt: typeof savedAt === "string" ? savedAt : null });
}

function isCompletionAction(value: unknown): value is CompletionAction {
  return value === "preserve" || value === "complete" || value === "incomplete";
}

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
