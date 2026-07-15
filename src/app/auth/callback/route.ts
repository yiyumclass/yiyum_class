import { NextResponse } from "next/server";
import { hasActiveAdminAccess } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";

// 카카오(및 모든 OAuth) 로그인 후 Supabase가 이 주소로 code를 붙여 리다이렉트한다.
// code를 세션으로 교환하고 로그인 완료 페이지로 보낸다.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requestedNext = searchParams.get("next");
  const next =
    requestedNext?.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const isAdmin = user
        ? await hasActiveAdminAccess(supabase, user.id)
        : false;
      return NextResponse.redirect(`${origin}${isAdmin ? "/admin" : next}`);
    }
  }

  // 실패 시 로그인 페이지로 (에러 표시)
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
