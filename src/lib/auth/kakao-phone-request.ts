import { normalizeKoreanMobileNumber } from "../messaging/phone.ts";

export type KakaoPhoneResult =
  | { ok: true; phone: string }
  | { ok: false; code: "KAKAO_CONFIGURATION_MISSING" | "KAKAO_LOOKUP_FAILED" | "KAKAO_ID_MISMATCH" | "PHONE_CONSENT_REQUIRED" | "PHONE_UNAVAILABLE" };

export async function lookupKakaoPhone(
  input: { kakaoUserId: string; accessToken?: string | null; adminKey?: string | null },
  request: typeof fetch = fetch
): Promise<KakaoPhoneResult> {
  if (!/^[1-9]\d*$/.test(input.kakaoUserId)) return { ok: false, code: "KAKAO_ID_MISMATCH" };
  const token = input.accessToken?.trim();
  const adminKey = input.adminKey?.trim();
  if (!token && !adminKey) return { ok: false, code: "KAKAO_CONFIGURATION_MISSING" };
  const url = new URL("https://kapi.kakao.com/v2/user/me");
  url.searchParams.set("property_keys", JSON.stringify(["kakao_account.phone_number"]));
  if (!token) {
    url.searchParams.set("target_id_type", "user_id");
    url.searchParams.set("target_id", input.kakaoUserId);
  }
  try {
    const response = await request(url, {
      method: "GET",
      headers: { Authorization: token ? `Bearer ${token}` : `KakaoAK ${adminKey}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { ok: false, code: "KAKAO_LOOKUP_FAILED" };
    const body = await response.text();
    const payload: unknown = JSON.parse(body, (key, value, context?: { source?: string }) => {
      if (key !== "id" || typeof value !== "number") return value;
      return context?.source ?? (Number.isSafeInteger(value) ? String(value) : null);
    });
    if (!isRecord(payload) || payload.id !== input.kakaoUserId) return { ok: false, code: "KAKAO_ID_MISMATCH" };
    const account = isRecord(payload.kakao_account) ? payload.kakao_account : null;
    if (account?.phone_number_needs_agreement !== false) return { ok: false, code: "PHONE_CONSENT_REQUIRED" };
    const phone = normalizeKoreanMobileNumber(account.phone_number);
    return phone ? { ok: true, phone } : { ok: false, code: "PHONE_UNAVAILABLE" };
  } catch {
    return { ok: false, code: "KAKAO_LOOKUP_FAILED" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
