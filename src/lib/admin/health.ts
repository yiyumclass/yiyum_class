import "server-only";

import { requireAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";

export type AdminIntegrationHealth = {
  publicOutlineReady: boolean;
  entitlementReady: boolean;
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

  const [outlineResult, entitlementResult, videoResult] = await Promise.all([
    supabase.rpc("get_public_course_catalog_outline"),
    supabase.rpc("get_my_active_product_entitlements"),
    supabase.rpc("get_course_video_manifest", {
      target_course_slug: "__admin-health-check__",
    }),
  ]);

  const publicOutlineReady = !outlineResult.error;
  const entitlementReady = !entitlementResult.error;
  const videoDeliveryReady = !videoResult.error;

  if (outlineResult.error) {
    console.error("Admin health check failed for public outline:", outlineResult.error.message);
  }
  if (entitlementResult.error) {
    console.error("Admin health check failed for entitlements:", entitlementResult.error.message);
  }
  if (videoResult.error) {
    console.error("Admin health check failed for video delivery:", videoResult.error.message);
  }

  return {
    publicOutlineReady,
    entitlementReady,
    videoDeliveryReady,
    allReady: publicOutlineReady && entitlementReady && videoDeliveryReady,
  };
}
