import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 카카오(및 모든 OAuth) 로그인 후 Supabase가 이 주소로 code를 붙여 리다이렉트한다.
// code를 세션으로 교환하고 로그인 완료 페이지로 보낸다.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/account";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // 실패 시 로그인 페이지로 (에러 표시)
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
