import { NextResponse } from "next/server";
import { hasActiveAdminAccess } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";

// 카카오(및 모든 OAuth) 로그인 후 Supabase가 이 주소로 code를 붙여 리다이렉트한다.
// code를 세션으로 교환하고 로그인 완료 페이지로 보낸다.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = normalizeInternalNext(searchParams.get("next"));

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
      return NextResponse.redirect(new URL(isAdmin ? "/admin" : next, origin));
    }
  }

  // 실패 시 로그인 페이지로 (에러 표시)
  const loginUrl = new URL("/login", origin);
  loginUrl.searchParams.set("error", "auth");
  if (next !== "/") {
    loginUrl.searchParams.set("next", next);
  }
  return NextResponse.redirect(loginUrl);
}

function normalizeInternalNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }

  const pathname = value.split(/[?#]/, 1)[0]?.replace(/\/+$/, "") || "/";
  if (pathname === "/login" || pathname === "/signup" || pathname === "/auth/callback") {
    return "/";
  }

  return value;
}
