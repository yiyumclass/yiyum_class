import "server-only";

import Mux from "@mux/mux-node";

let cachedClient: Mux | null = null;

/**
 * Mux API 클라이언트. 토큰이 없으면 조용히 넘어가지 않고 즉시 알린다.
 * 영상 업로드·재생이 전부 이 자격증명에 걸려 있어서, 미설정을 나중에 발견하면
 * 원인 추적이 어렵다.
 */
export function getMuxClient(): Mux {
  if (cachedClient) return cachedClient;

  const tokenId = process.env.MUX_TOKEN_ID;
  const tokenSecret = process.env.MUX_TOKEN_SECRET;

  if (!tokenId || !tokenSecret) {
    throw new Error("MUX_TOKEN_ID and MUX_TOKEN_SECRET are required.");
  }

  cachedClient = new Mux({ tokenId, tokenSecret });
  return cachedClient;
}

/**
 * 재생 토큰 서명에는 업로드용 토큰과 다른 키를 쓴다.
 * 설정 화면과 헬스체크가 "업로드는 되는데 재생이 안 되는" 상태를 구분해야 해서
 * 존재 여부를 따로 확인할 수 있게 열어 둔다.
 */
export function isMuxUploadConfigured() {
  return Boolean(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET);
}

export function isMuxPlaybackConfigured() {
  return Boolean(
    process.env.MUX_SIGNING_KEY_ID && process.env.MUX_SIGNING_KEY_PRIVATE
  );
}

export function isMuxConfigured() {
  return isMuxUploadConfigured() && isMuxPlaybackConfigured();
}
