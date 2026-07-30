import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * ready       실제 영상 하나를 매니페스트 조회부터 서명까지 왕복 검증했다.
 * no-content  연결된 영상이 없어 검증할 대상이 없다. 고장과 구분해서 표시한다.
 * failed      경로 어딘가가 끊겼다.
 */
export type VideoDeliveryStatus = "ready" | "no-content" | "failed";

export type AdminIntegrationHealth = {
  publicOutlineReady: boolean;
  entitlementReady: boolean;
  libraryReady: boolean;
  ownedCourseReady: boolean;
  videoDelivery: VideoDeliveryStatus;
  allReady: boolean;
};

type LessonProbeRow = {
  lesson_key: string;
  video_path: string;
  section_id: string;
};

type ManifestRow = { lesson_key: string };

const HEALTH_CHECK_SIGN_TTL_SECONDS = 30;

/**
 * 어드민 기본 테이블뿐 아니라 사용자 화면이 의존하는 읽기 전용 RPC까지 확인한다.
 * 대시보드가 일부 마이그레이션 누락을 "운영 데이터 최신"으로 오인하지 않게 한다.
 */
export async function loadAdminIntegrationHealth(): Promise<AdminIntegrationHealth> {
  await requireAdmin();
  const supabase = await createClient();

  const [
    outlineResult,
    entitlementResult,
    libraryResult,
    ownedCourseResult,
    videoDelivery,
  ] = await Promise.all([
    supabase.rpc("get_public_course_catalog_outline"),
    supabase.rpc("get_my_active_product_entitlements"),
    supabase.rpc("get_my_active_product_library"),
    supabase.rpc("get_my_active_course_catalog_outline"),
    probeVideoDelivery(supabase),
  ]);

  const publicOutlineReady = !outlineResult.error;
  const entitlementReady = !entitlementResult.error;
  const libraryReady = !libraryResult.error;
  const ownedCourseReady = !ownedCourseResult.error;

  if (outlineResult.error) {
    console.error("Admin health check failed for public outline:", outlineResult.error.message);
  }
  if (entitlementResult.error) {
    console.error("Admin health check failed for entitlements:", entitlementResult.error.message);
  }
  if (libraryResult.error) {
    console.error("Admin health check failed for product library:", libraryResult.error.message);
  }
  if (ownedCourseResult.error) {
    console.error("Admin health check failed for owned course catalog:", ownedCourseResult.error.message);
  }

  return {
    publicOutlineReady,
    entitlementReady,
    libraryReady,
    ownedCourseReady,
    videoDelivery,
    allReady:
      publicOutlineReady &&
      entitlementReady &&
      libraryReady &&
      ownedCourseReady &&
      videoDelivery === "ready",
  };
}

/**
 * 실제로 연결된 차시 영상 하나를 골라 수강생과 같은 경로를 따라가 본다.
 * 차시 → 강의 slug → 매니페스트 RPC → 스토리지 서명까지 이어져야 통과다.
 *
 * 존재하지 않는 slug로 RPC를 호출하면 함수가 있다는 것만 확인될 뿐,
 * 조인이 끊겼거나 버킷에 객체가 없어도 통과해버린다. 그래서 실제 데이터를 쓴다.
 */
async function probeVideoDelivery(
  supabase: SupabaseClient
): Promise<VideoDeliveryStatus> {
  const lessonResult = await findProbeLesson(supabase);

  if (lessonResult.error) {
    console.error(
      "Admin health check failed for connected video lookup:",
      lessonResult.error.message
    );
    return "failed";
  }
  if (!lessonResult.data) {
    return probeVideoDeliveryWithoutContent(supabase);
  }

  const lesson = lessonResult.data;
  const courseSlug = await resolveCourseSlug(supabase, lesson.section_id);
  if (!courseSlug) return "failed";

  const manifestResult = await supabase.rpc("get_course_video_manifest", {
    target_course_slug: courseSlug,
  });
  if (manifestResult.error) {
    console.error(
      "Admin health check failed for video manifest:",
      manifestResult.error.message
    );
    return "failed";
  }

  const rows = (manifestResult.data ?? []) as unknown as ManifestRow[];
  if (!rows.some((row) => row.lesson_key === lesson.lesson_key)) {
    console.error(
      "Admin health check failed: the video manifest omitted a connected lesson.",
      courseSlug
    );
    return "failed";
  }

  // 버킷에 객체가 실제로 올라와 있지 않으면 여기서 걸린다.
  const signedResult = await supabase.storage
    .from("course-videos")
    .createSignedUrl(lesson.video_path, HEALTH_CHECK_SIGN_TTL_SECONDS);
  if (signedResult.error || !signedResult.data?.signedUrl) {
    console.error(
      "Admin health check failed for private video storage:",
      signedResult.error?.message ?? "missing signed url"
    );
    return "failed";
  }

  return "ready";
}

/**
 * 검사 대상을 매번 같은 차시로 고정한다. 정렬 없이 뽑으면 실행마다 다른 차시를
 * 검사해 결과가 흔들린다. 수강생이 실제로 보는 published 차시를 우선한다.
 */
async function findProbeLesson(supabase: SupabaseClient) {
  const baseQuery = () =>
    supabase
      .from("lessons")
      .select("lesson_key, video_path, section_id")
      .eq("video_provider", "supabase")
      .not("video_path", "is", null)
      .order("lesson_key", { ascending: true })
      .limit(1);

  const publishedResult = await baseQuery()
    .eq("status", "published")
    .maybeSingle<LessonProbeRow>();

  if (publishedResult.error || publishedResult.data) return publishedResult;

  // 공개된 영상이 아직 없으면 작성 중·보관 차시라도 경로를 검증해 둔다.
  return baseQuery().maybeSingle<LessonProbeRow>();
}

/**
 * 연결된 영상이 아직 없는 단계. 왕복 검증은 못 하지만 마이그레이션과 버킷이
 * 준비됐는지는 확인해 둔다. 통과해도 "정상"이 아니라 "검증 대상 없음"이다.
 */
async function probeVideoDeliveryWithoutContent(
  supabase: SupabaseClient
): Promise<VideoDeliveryStatus> {
  const [manifestResult, bucketResult] = await Promise.all([
    supabase.rpc("get_course_video_manifest", {
      target_course_slug: "__admin-health-check__",
    }),
    supabase.storage.from("course-videos").list("", { limit: 1 }),
  ]);

  if (manifestResult.error) {
    console.error(
      "Admin health check failed for video manifest:",
      manifestResult.error.message
    );
    return "failed";
  }
  if (bucketResult.error) {
    console.error(
      "Admin health check failed for private video storage:",
      bucketResult.error.message
    );
    return "failed";
  }

  return "no-content";
}

async function resolveCourseSlug(supabase: SupabaseClient, sectionId: string) {
  const sectionResult = await supabase
    .from("course_sections")
    .select("course_id")
    .eq("id", sectionId)
    .maybeSingle<{ course_id: string }>();

  if (sectionResult.error || !sectionResult.data) {
    console.error(
      "Admin health check failed to resolve the section of a connected video:",
      sectionResult.error?.message ?? "section not found"
    );
    return null;
  }

  const courseResult = await supabase
    .from("courses")
    .select("slug")
    .eq("id", sectionResult.data.course_id)
    .maybeSingle<{ slug: string }>();

  if (courseResult.error || !courseResult.data) {
    console.error(
      "Admin health check failed to resolve the course of a connected video:",
      courseResult.error?.message ?? "course not found"
    );
    return null;
  }

  return courseResult.data.slug;
}
