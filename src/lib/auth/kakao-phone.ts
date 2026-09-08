import "server-only";

import { readKakaoAccountMobileNumber } from "@/lib/messaging/phone";

const KAKAO_USER_INFO_URL = "https://kapi.kakao.com/v2/user/me";
const KAKAO_USER_INFO_TIMEOUT_MS = 8_000;

/** OAuth 액세스 토큰으로 카카오에서 동의받은 전화번호를 직접 조회한다. */
export async function fetchKakaoMobileNumber(
  accessToken: string
): Promise<string | null> {
  const token = accessToken.trim();
  if (!token) return null;

  const url = new URL(KAKAO_USER_INFO_URL);
  url.searchParams.set(
    "property_keys",
    JSON.stringify(["kakao_account.phone_number"])
  );

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(KAKAO_USER_INFO_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("Kakao phone number request failed:", readErrorName(error));
    return null;
  }

  if (!response.ok) {
    console.error("Kakao phone number request was rejected:", response.status);
    return null;
  }

  try {
    return readKakaoAccountMobileNumber(await response.json());
  } catch {
    console.error("Kakao phone number response was invalid");
    return null;
  }
}

function readErrorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}
