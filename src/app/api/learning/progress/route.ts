import { hasActiveAdminAccess } from "@/lib/admin/access";
import { hasActiveProductEntitlement } from "@/lib/store/entitlements";
import { loadPublicCourseBySlug } from "@/lib/store/public-course-catalog";
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

export async function POST(request: Request) {
  const supabase = await createClient();
  const identity = await getVerifiedIdentity(supabase);

  if (!identity) {
    return json({ error: "로그인이 필요합니다." }, 401);
  }

  let payload: ProgressPayload;
  try {
    payload = (await request.json()) as ProgressPayload;
  } catch {
    return json({ error: "올바른 요청 형식이 아닙니다." }, 400);
  }

  if (
    typeof payload.courseSlug !== "string" ||
    typeof payload.lessonId !== "string" ||
    typeof payload.positionSeconds !== "number" ||
    typeof payload.durationSeconds !== "number" ||
    !isCompletionAction(payload.completionAction)
  ) {
    return json({ error: "진도 정보가 올바르지 않습니다." }, 400);
  }

  const [isAdmin, hasEntitlement, catalogItem] = await Promise.all([
    hasActiveAdminAccess(supabase, identity.userId),
    hasActiveProductEntitlement(supabase, payload.courseSlug),
    loadPublicCourseBySlug(payload.courseSlug),
  ]);
  if (!isAdmin && !hasEntitlement) {
    return json({ error: "수강 신청이 필요한 강의입니다." }, 403);
  }

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
  const now = new Date().toISOString();
  const row: Record<string, string | number | null> = {
    user_id: identity.userId,
    course_slug: course.slug,
    lesson_id: lesson.id,
    last_position_seconds: positionSeconds,
    duration_seconds: durationSeconds,
    last_watched_at: now,
    updated_at: now,
  };

  if (payload.completionAction === "complete") {
    row.completed_at = now;
  } else if (payload.completionAction === "incomplete") {
    row.completed_at = null;
  }

  const { error } = await supabase.from("lesson_progress").upsert(row, {
    onConflict: "user_id,course_slug,lesson_id",
    defaultToNull: false,
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

  return json({ ok: true, savedAt: now });
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
