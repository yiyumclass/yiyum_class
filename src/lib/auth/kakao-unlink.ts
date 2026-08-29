import "server-only";

import { parseKakaoUnlinkResponse } from "@/lib/auth/account-withdrawal";

const KAKAO_UNLINK_URL = "https://kapi.kakao.com/v1/user/unlink";
const KAKAO_UNLINK_TIMEOUT_MS = 8_000;

export type KakaoUnlinkResult =
  | { ok: true }
  | {
      ok: false;
      code: number | null;
      reason: "configuration" | "network" | "api" | "invalid-response";
    };

export async function unlinkKakaoAccount(
  kakaoUserId: string
): Promise<KakaoUnlinkResult> {
  const adminKey = process.env.KAKAO_ADMIN_KEY?.trim();
  if (!adminKey) {
    return { ok: false, code: null, reason: "configuration" };
  }

  let response: Response;
  try {
    response = await fetch(KAKAO_UNLINK_URL, {
      method: "POST",
      headers: {
        Authorization: `KakaoAK ${adminKey}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body: new URLSearchParams({
        target_id_type: "user_id",
        target_id: kakaoUserId,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(KAKAO_UNLINK_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("Kakao account unlink request failed:", readErrorName(error));
    return { ok: false, code: null, reason: "network" };
  }

  const body = await response.text();
  const result = parseKakaoUnlinkResponse(
    response.status,
    body,
    kakaoUserId
  );
  if (result.ok) return { ok: true };

  console.error(
    "Kakao account unlink was rejected:",
    result.code ?? result.reason
  );
  return {
    ok: false,
    code: result.code,
    reason: result.reason,
  };
}

function readErrorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}
