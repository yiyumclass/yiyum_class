import { type NextRequest } from "next/server";
import { buildContentSecurityPolicy } from "@/lib/http/content-security-policy";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDevelopment = process.env.NODE_ENV === "development";
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    isDevelopment,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-nonce", nonce);
  forwardedHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = await updateSession(request, forwardedHeaders);
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

export const config = {
  // 정적 파일·이미지 등을 제외한 모든 경로에서 세션 갱신
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
