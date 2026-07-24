const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isSameOriginRequest(request: Request) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

  const origin = request.headers.get("origin");
  if (!origin) return false;

  const allowedOrigin = getRequestOrigin(request);
  return origin === allowedOrigin;
}

function getRequestOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return new URL(configured).origin;

  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedHost) {
    return `${forwardedProto || "https"}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}
