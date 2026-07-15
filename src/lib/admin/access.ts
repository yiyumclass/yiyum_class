import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 로그인 직후 이동 경로와 공개 헤더 노출을 위한 가벼운 관리자 확인.
 * 실제 관리자 페이지와 저장 작업은 서버 DAL에서 권한을 다시 검증한다.
 */
export async function hasActiveAdminAccess(
  supabase: SupabaseClient,
  userId: string
) {
  const { data, error } = await supabase
    .from("admin_users")
    .select("role, is_active")
    .eq("user_id", userId)
    .maybeSingle<{ role: string; is_active: boolean }>();

  if (error || !data?.is_active) return false;
  return data.role === "owner" || data.role === "operator";
}
