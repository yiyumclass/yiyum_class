import type { SupabaseClient } from "@supabase/supabase-js";

const SETUP_ERROR_CODES = new Set(["42883", "PGRST202", "PGRST205"]);

/**
 * 탈퇴 처리 중이거나 soft delete된 JWT를 애플리케이션 인증으로 인정하지 않는다.
 * 마이그레이션이 아직 배포되지 않은 짧은 호환 구간에는 기존 인증 동작을 유지한다.
 */
export async function hasActiveAccount(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("is_active_account");
  if (!error) return data === true;

  if (SETUP_ERROR_CODES.has(error.code)) return true;

  console.error("Failed to verify active account status:", error.code);
  return false;
}
