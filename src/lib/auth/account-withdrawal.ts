export const ACCOUNT_WITHDRAWAL_CONFIRMATION = "회원탈퇴";
export const ACCOUNT_WITHDRAWAL_REAUTH_WINDOW_MS = 15 * 60 * 1000;

export function isValidWithdrawalConfirmation(value: unknown) {
  return (
    typeof value === "string" &&
    value.trim() === ACCOUNT_WITHDRAWAL_CONFIRMATION
  );
}

export function hasRecentAuthentication(
  lastSignInAt: string | undefined,
  now = Date.now()
) {
  if (!lastSignInAt) return false;

  const signedInAt = Date.parse(lastSignInAt);
  if (!Number.isFinite(signedInAt) || signedInAt > now) return false;

  return now - signedInAt <= ACCOUNT_WITHDRAWAL_REAUTH_WINDOW_MS;
}

type KakaoIdentity = {
  id?: unknown;
  provider?: unknown;
  identity_data?: Record<string, unknown> | null;
};

export function readKakaoUserId(
  identities: KakaoIdentity[] | null | undefined
) {
  const identity = identities?.find((item) => item.provider === "kakao");
  if (!identity) return null;

  const candidates = [identity.identity_data?.sub, identity.id];
  for (const candidate of candidates) {
    const value =
      typeof candidate === "number" && Number.isSafeInteger(candidate)
        ? String(candidate)
        : typeof candidate === "string"
          ? candidate.trim()
          : "";
    if (/^[1-9]\d*$/.test(value)) return value;
  }

  return null;
}

export type KakaoUnlinkResponse =
  | { ok: true; userId: string }
  | { ok: false; code: number | null; reason: "api" | "invalid-response" };

export function parseKakaoUnlinkResponse(
  status: number,
  body: string,
  expectedUserId: string
): KakaoUnlinkResponse {
  const idMatch = body.match(/"id"\s*:\s*(?:"([1-9]\d*)"|([1-9]\d*))/);
  const returnedUserId = idMatch?.[1] ?? idMatch?.[2] ?? null;

  if (status >= 200 && status < 300) {
    if (returnedUserId === expectedUserId) {
      return { ok: true, userId: returnedUserId };
    }
    return { ok: false, code: null, reason: "invalid-response" };
  }

  const codeMatch = body.match(/"code"\s*:\s*(-?\d+)/);
  return {
    ok: false,
    code: codeMatch ? Number(codeMatch[1]) : null,
    reason: "api",
  };
}
