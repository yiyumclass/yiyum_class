// 비밀번호 검증. 클라이언트와 서버 어느 쪽에서도 쓸 수 있게 순수 함수로 둔다.

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72; // bcrypt가 그 이상을 잘라내므로 미리 막는다.

export type PasswordCheckResult = { ok: true } | { ok: false; message: string };

/**
 * 이메일 로그인 계정은 사실상 관리자 계정이라 기본 6자보다 길게 요구한다.
 * 복잡도 규칙 대신 길이를 늘리는 편이 실제 강도에 더 도움이 된다.
 */
export function checkNewPassword(
  password: string,
  confirmation: string
): PasswordCheckResult {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`,
    };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `비밀번호는 ${MAX_PASSWORD_LENGTH}자 이하로 입력해 주세요.`,
    };
  }
  if (!password.trim()) {
    return { ok: false, message: "공백만으로는 비밀번호를 만들 수 없습니다." };
  }
  if (password !== confirmation) {
    return { ok: false, message: "비밀번호 확인이 일치하지 않습니다." };
  }

  return { ok: true };
}
