export type OAuthConsentGateDecision = "allow" | "require" | "unavailable";

export const AUTH_CONSENT_ENFORCED_AT = "2026-07-24T00:00:00.000Z";

type OAuthConsentGateInput = {
  isAdmin: boolean;
  userCreatedAt: string;
  existingConsent: boolean;
  consentIntent: boolean;
  consentLookupFailed: boolean;
};

/**
 * OAuth callback에서 세션을 계속할 수 있는지 결정한다.
 * 동의 조회가 실패한 경우 비관리자는 안전하게 중단한다(fail-closed).
 */
export function resolveOAuthConsentGate({
  isAdmin,
  userCreatedAt,
  existingConsent,
  consentIntent,
  consentLookupFailed,
}: OAuthConsentGateInput): OAuthConsentGateDecision {
  if (!isAdmin && consentLookupFailed) return "unavailable";

  const requiresSignupConsent =
    !isAdmin &&
    new Date(userCreatedAt).getTime() >=
      new Date(AUTH_CONSENT_ENFORCED_AT).getTime() &&
    !existingConsent &&
    !consentIntent;

  return requiresSignupConsent ? "require" : "allow";
}
