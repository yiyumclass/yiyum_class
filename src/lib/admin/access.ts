import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 이 모듈은 서버·클라이언트 양쪽에서 의도적으로 함께 쓰인다(AuthForm의 로그인 후 리다이렉트 힌트 등).
 * 따라서 server-only 로직(next/headers, cookies, 서버 전용 클라이언트 등)을 추가하지 말 것.
 * 실제 /admin 접근 보호와 저장 작업의 권한 검증은 requireAdmin()이 담당한다.
 */

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
