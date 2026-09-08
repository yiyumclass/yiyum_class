import { isIP } from "node:net";

const USER_AGENT_MAX_LENGTH = 512;
const REQUEST_ID_MAX_LENGTH = 128;

export type SecurityAccessContext = {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
};

/**
 * Vercel/리버스 프록시가 전달한 헤더 중 유효한 IP만 기록한다.
 * 애플리케이션은 신뢰할 수 있는 프록시 뒤에서 실행된다는 전제이며,
 * 임의 문자열이나 여러 단계의 전체 프록시 체인은 보관하지 않는다.
 */
export function readSecurityAccessContext(
  requestHeaders: Pick<Headers, "get">
): SecurityAccessContext {
  const forwardedFor = requestHeaders.get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const realIp = requestHeaders.get("x-real-ip")?.trim();

  return {
    ipAddress: firstValidIp(forwardedFor, realIp),
    userAgent: sanitizeHeader(
      requestHeaders.get("user-agent"),
      USER_AGENT_MAX_LENGTH
    ),
    requestId: sanitizeHeader(
      requestHeaders.get("x-vercel-id"),
      REQUEST_ID_MAX_LENGTH
    ),
  };
}

function firstValidIp(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    if (candidate && isIP(candidate) !== 0) return candidate;
  }
  return null;
}

function sanitizeHeader(value: string | null, maxLength: number) {
  if (!value) return null;

  const sanitized = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, maxLength);
  return sanitized || null;
}
