type ContentSecurityPolicyOptions = {
  nonce: string;
  isDevelopment: boolean;
  supabaseUrl?: string;
};

export function buildContentSecurityPolicy({
  nonce,
  isDevelopment,
  supabaseUrl,
}: ContentSecurityPolicyOptions) {
  const supabaseOrigin = getConfiguredOrigin(supabaseUrl);
  const connectSources = [
    "'self'",
    supabaseOrigin,
    "https://*.supabase.co",
    "wss://*.supabase.co",
    "https://*.tosspayments.com",
    // Mux: HLS 매니페스트·세그먼트 조회와 브라우저 직접 업로드.
    // 업로드 호스트는 계정 지역마다 다르므로 mux.com 하위로만 제한한다.
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

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""} https://js.tosspayments.com`,
    // React style 속성은 현재 화면 전반에서 사용하므로 style-src-attr에만 한정 허용한다.
    // 스타일 태그와 외부 스타일은 nonce 및 명시한 출처만 허용한다.
    `style-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net https://fonts.googleapis.com`,
    "style-src-attr 'unsafe-inline'",
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
}

function getConfiguredOrigin(value: string | undefined) {
  if (!value) return "";

  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}
