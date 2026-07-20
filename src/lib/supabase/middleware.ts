import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// 매 요청마다 Supabase 세션 토큰을 갱신하고 쿠키를 동기화한다.
// 이게 없으면 세션이 만료돼도 갱신되지 않아 로그인이 풀린 것처럼 보인다.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 서명 검증과 만료 임박 토큰 갱신을 수행한다. 비대칭 서명 claims는 JWKS가
  // 캐시된 뒤 Auth 서버를 매번 호출하지 않고 로컬에서 검증된다.
  await supabase.auth.getClaims();

  return supabaseResponse;
}
