import type { SupabaseClient } from "@supabase/supabase-js";

export type VerifiedIdentity = {
  userId: string;
  email: string | null;
  metadata: Record<string, unknown>;
};

/**
 * 사용자 레코드 전체가 필요하지 않은 요청은 서명된 JWT claims만 검증한다.
 * 현재 프로젝트는 비대칭 서명 키를 사용하므로 JWKS가 준비된 뒤에는
 * Auth 서버 왕복 없이 로컬에서 검증할 수 있다.
 */
export async function getVerifiedIdentity(
  supabase: SupabaseClient
): Promise<VerifiedIdentity | null> {
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims || typeof claims.sub !== "string") return null;

  return {
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    metadata: isRecord(claims.user_metadata) ? claims.user_metadata : {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
