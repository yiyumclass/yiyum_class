import "server-only";

import { requireAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";

export type AdminIntegrationHealth = {
  publicOutlineReady: boolean;
  entitlementReady: boolean;
  libraryReady: boolean;
  ownedCourseReady: boolean;
  videoDeliveryReady: boolean;
  allReady: boolean;
};

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
    manifestResult,
    videoObjectResult,
  ] = await Promise.all([
    supabase.rpc("get_public_course_catalog_outline"),
    supabase.rpc("get_my_active_product_entitlements"),
    supabase.rpc("get_my_active_product_library"),
    supabase.rpc("get_my_active_course_catalog_outline"),
    supabase.rpc("get_course_video_manifest", {
      target_course_slug: "__admin-health-check__",
    }),
    supabase
      .from("lessons")
      .select("video_path")
      .eq("video_provider", "supabase")
      .not("video_path", "is", null)
      .limit(1)
      .maybeSingle<{ video_path: string | null }>(),
  ]);

  const publicOutlineReady = !outlineResult.error;
  const entitlementReady = !entitlementResult.error;
  const libraryReady = !libraryResult.error;
  const ownedCourseReady = !ownedCourseResult.error;
  const storageResult = videoObjectResult.data?.video_path
    ? await supabase.storage
        .from("course-videos")
        .createSignedUrl(videoObjectResult.data.video_path, 30)
    : await supabase.storage.from("course-videos").list("", { limit: 1 });
  const videoDeliveryReady =
    !manifestResult.error && !videoObjectResult.error && !storageResult.error;

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
  if (manifestResult.error) {
    console.error("Admin health check failed for video manifest:", manifestResult.error.message);
  }
  if (videoObjectResult.error) {
    console.error("Admin health check failed for connected video lookup:", videoObjectResult.error.message);
  }
  if (storageResult.error) {
    console.error("Admin health check failed for private video storage:", storageResult.error.message);
  }

  return {
    publicOutlineReady,
    entitlementReady,
    libraryReady,
    ownedCourseReady,
    videoDeliveryReady,
    allReady:
      publicOutlineReady &&
      entitlementReady &&
      libraryReady &&
      ownedCourseReady &&
      videoDeliveryReady,
  };
}
