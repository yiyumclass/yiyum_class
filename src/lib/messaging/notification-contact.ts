import { readKakaoUserId } from "../auth/account-withdrawal.ts";
import type { KakaoPhoneResult } from "../auth/kakao-phone-request.ts";
import { normalizeKoreanMobileNumber } from "./phone.ts";

export type NotificationContactUser = {
  id: string;
  identities?: Parameters<typeof readKakaoUserId>[0];
};

export type VerifiedNotificationContact = {
  kakao_user_id: string;
  phone: string;
  verified_at: string;
};

type ContactCode = Exclude<KakaoPhoneResult, { ok: true }>['code'] | "KAKAO_ID_UNAVAILABLE" | "CONTACT_STORAGE_FAILED" | "ACCOUNT_INACTIVE";

export class NotificationContactError extends Error {
  readonly code: ContactCode;

  constructor(code: ContactCode) {
    super(code);
    this.code = code;
  }

  get needsContact() {
    return ["KAKAO_ID_UNAVAILABLE", "KAKAO_ID_MISMATCH", "PHONE_CONSENT_REQUIRED", "PHONE_UNAVAILABLE", "ACCOUNT_INACTIVE"].includes(this.code);
  }
}

export type NotificationContactPorts = {
  load: (userId: string) => Promise<VerifiedNotificationContact | null>;
  save: (userId: string, contact: VerifiedNotificationContact) => Promise<void>;
  remove: (userId: string) => Promise<void>;
  lookup: (kakaoUserId: string) => Promise<KakaoPhoneResult>;
};

export async function resolveNotificationContact(
  user: NotificationContactUser,
  ports: NotificationContactPorts,
  options: { refresh?: boolean; now?: number } = {}
): Promise<string> {
  const identities = user.identities?.filter(identity => identity.provider === "kakao") ?? [];
  const kakaoUserId = identities.length === 1 ? readKakaoUserId(identities) : null;
  if (!kakaoUserId) throw new NotificationContactError("KAKAO_ID_UNAVAILABLE");
  const now = options.now ?? Date.now();
  const cached = await ports.load(user.id);
  const age = cached ? now - Date.parse(cached.verified_at) : NaN;
  if (!options.refresh && cached?.kakao_user_id === kakaoUserId && age >= 0 && age < 24 * 60 * 60_000) {
    const phone = normalizeKoreanMobileNumber(cached.phone);
    if (phone) return phone;
  }
  const result = await ports.lookup(kakaoUserId);
  if (!result.ok) {
    if (["PHONE_CONSENT_REQUIRED", "PHONE_UNAVAILABLE", "KAKAO_ID_MISMATCH"].includes(result.code)) await ports.remove(user.id);
    throw new NotificationContactError(result.code);
  }
  const phone = normalizeKoreanMobileNumber(result.phone);
  if (!phone) throw new NotificationContactError("PHONE_UNAVAILABLE");
  await ports.save(user.id, { kakao_user_id: kakaoUserId, phone, verified_at: new Date(now).toISOString() });
  return phone;
}
