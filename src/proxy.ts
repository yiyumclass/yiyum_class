import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDevelopment = process.env.NODE_ENV === "development";
  const supabaseOrigin = getConfiguredOrigin(
    process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  const connectSources = [
    "'self'",
    supabaseOrigin,
    "https://*.supabase.co",
    "wss://*.supabase.co",
    "https://*.tosspayments.com",
    // Mux: HLS 매니페스트·세그먼트 조회와 브라우저 직접 업로드.
    // 업로드 호스트는 계정 지역마다 다르다(예: direct-uploads-oci-us-phoenix-1-vop1).
    // 고정할 수 없어 mux.com 하위로 열되, 그 밖의 호스트는 열지 않는다.
    "https://*.mux.com",
    "https://inferred.litix.io",
  ].filter(Boolean);
  const mediaSources = [
    "'self'",
    "blob:",
    supabaseOrigin,
    "https://*.supabase.co",
    "https://stream.mux.com",
  ].filter(Boolean);
  const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""} https://js.tosspayments.com`,
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
    "img-src 'self' blob: data: https://*.supabase.co https://image.mux.com",
    `media-src ${mediaSources.join(" ")}`,
    `connect-src ${connectSources.join(" ")}`,
    "frame-src https://*.tosspayments.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://*.tosspayments.com",
    "frame-ancestors 'none'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-nonce", nonce);
  forwardedHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = await updateSession(request, forwardedHeaders);
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

function getConfiguredOrigin(value: string | undefined) {
  if (!value) return "";

  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

export const config = {
  // 정적 파일·이미지 등을 제외한 모든 경로에서 세션 갱신
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
