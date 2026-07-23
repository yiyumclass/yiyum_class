import type { NextConfig } from "next";

const contentSecurityPolicy = "base-uri 'self'; object-src 'none'; frame-ancestors 'none'";

// 전 경로 공통 보안 헤더. CSP는 인라인 스타일·Supabase 도메인 의존을 피하기 위해
// 렌더링 리소스 정책 없이 강제 가능한 지시문만 적용한다.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
