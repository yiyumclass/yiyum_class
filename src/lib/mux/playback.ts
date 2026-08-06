import "server-only";

import { getMuxClient } from "@/lib/mux/client";

const MUX_STREAM_ORIGIN = "https://stream.mux.com";

// 토큰이 재생 도중 만료되면 화면이 멈춘다. 차시 길이에 여유를 더해 잡되,
// 링크가 유출됐을 때의 노출 창을 줄이려고 상한을 둔다.
const MIN_TOKEN_SECONDS = 30 * 60;
const MAX_TOKEN_SECONDS = 3 * 60 * 60;
const TOKEN_HEADROOM_SECONDS = 15 * 60;

function resolveExpirationSeconds(durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return MIN_TOKEN_SECONDS;
  }

  const withHeadroom = Math.ceil(durationSeconds) + TOKEN_HEADROOM_SECONDS;
  return Math.min(MAX_TOKEN_SECONDS, Math.max(MIN_TOKEN_SECONDS, withHeadroom));
}

/**
 * 재생 토큰만 만든다. Mux Player 는 URL 대신 playbackId + token 조합을 받는다.
 * 수강권 확인은 호출부가 이미 끝낸 뒤라고 가정한다. 이 함수는 권한을 판단하지 않는다.
 */
export async function createSignedPlaybackToken(
  playbackId: string,
  durationSeconds: number
) {
  const keyId = process.env.MUX_SIGNING_KEY_ID;
  const keySecret = process.env.MUX_SIGNING_KEY_PRIVATE;

  if (!keyId || !keySecret) {
    throw new Error(
      "MUX_SIGNING_KEY_ID and MUX_SIGNING_KEY_PRIVATE are required to sign playback."
    );
  }

  const expirationSeconds = resolveExpirationSeconds(durationSeconds);
  const mux = getMuxClient();

  const token = await mux.jwt.signPlaybackId(playbackId, {
    keyId,
    keySecret,
    type: "video",
    expiration: `${expirationSeconds}s`,
  });

  return { token, expiresInSeconds: expirationSeconds };
}

/**
 * 서명된 HLS 재생 URL. 기존 재생 라우트가 리다이렉트 대상으로 쓴다.
 */
export async function createSignedPlaybackUrl(
  playbackId: string,
  durationSeconds: number
) {
  const { token, expiresInSeconds } = await createSignedPlaybackToken(
    playbackId,
    durationSeconds
  );

  return {
    url: `${MUX_STREAM_ORIGIN}/${playbackId}.m3u8?token=${token}`,
    expiresInSeconds,
  };
}
