type AuthUserProfile = {
  user_metadata?: Record<string, unknown> | null;
};

const DISPLAY_NAME_KEYS = [
  "full_name",
  "name",
  "preferred_username",
  "user_name",
  "nickname",
] as const;

/** 카카오를 포함한 OAuth 사용자 메타데이터에서 알림톡 표시 이름을 읽는다. */
export function readAuthUserDisplayName(user: AuthUserProfile): string {
  const metadata = user.user_metadata ?? {};

  for (const key of DISPLAY_NAME_KEYS) {
    const value = metadata[key];
    if (typeof value !== "string") continue;

    const displayName = value.trim();
    if (displayName) return displayName;
  }

  return "회원";
}
