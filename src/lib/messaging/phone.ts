type AuthUserContact = {
  phone?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

/** SOLAPI가 요구하는 하이픈 없는 국내 휴대전화 번호로 정규화한다. */
export function normalizeKoreanMobileNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/\D/g, "");
  const domestic = digits.startsWith("82")
    ? `0${digits.slice(2)}`
    : digits;

  return /^010\d{8}$/.test(domestic) ? domestic : null;
}

/** Supabase의 Auth 전화번호와 카카오 provider metadata를 모두 지원한다. */
export function readAuthUserMobileNumber(user: AuthUserContact): string | null {
  const metadata = user.user_metadata ?? {};
  const candidates = [
    user.phone,
    metadata.phone,
    metadata.phone_number,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeKoreanMobileNumber(candidate);
    if (normalized) return normalized;
  }

  return null;
}
