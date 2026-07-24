import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hasActiveAdminAccess } from "@/lib/admin/access";
import {
  AUTH_CONSENT_ENFORCED_AT,
  AUTH_PRIVACY_VERSION,
  AUTH_TERMS_VERSION,
  OAUTH_CONSENT_COOKIE,
  readOAuthConsentCookieValue,
} from "@/lib/auth/oauth-consent";
import { normalizeInternalNext } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

// 카카오(및 모든 OAuth) 로그인 후 Supabase가 이 주소로 code를 붙여 리다이렉트한다.
// code를 세션으로 교환하고 로그인 완료 페이지로 보낸다.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = normalizeInternalNext(searchParams.get("next"));
  const cookieStore = await cookies();

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return redirectToLogin(origin, next);

      const consentIntent = readOAuthConsentCookieValue(
        cookieStore.get(OAUTH_CONSENT_COOKIE)?.value
      );
      const isAdmin = await hasActiveAdminAccess(supabase, user.id);
      const { data: existingConsent, error: consentLookupError } = await supabase
        .from("user_auth_consents")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle<{ user_id: string }>();
      const requiresSignupConsent =
        !isAdmin &&
        new Date(user.created_at).getTime() >=
          new Date(AUTH_CONSENT_ENFORCED_AT).getTime() &&
        (!existingConsent || Boolean(consentLookupError)) &&
        !consentIntent;
      if (requiresSignupConsent) {
        await supabase.auth.signOut();
        const signupUrl = new URL("/signup", origin);
        signupUrl.searchParams.set("error", "consent");
        if (next !== "/") signupUrl.searchParams.set("next", next);
        return NextResponse.redirect(signupUrl);
      }

      if (consentIntent) {
        const { error: consentError } = await supabase.rpc("record_my_auth_consent", {
          terms_version: AUTH_TERMS_VERSION,
          privacy_version: AUTH_PRIVACY_VERSION,
          age14_confirmed: consentIntent.age14Confirmed,
          marketing_opt_in: consentIntent.marketingOptIn,
        });
        if (consentError) {
          console.error("Failed to record OAuth consent:", consentError.code);
          await supabase.auth.signOut();
          return redirectToLogin(origin, next);
        }

        await supabase.auth.updateUser({
          data: {
            terms_version: AUTH_TERMS_VERSION,
            privacy_version: AUTH_PRIVACY_VERSION,
            age14_confirmed: true,
            marketing_opt_in: consentIntent.marketingOptIn,
            marketing_preference_updated_at: new Date().toISOString(),
          },
        });
      }

      cookieStore.delete(OAUTH_CONSENT_COOKIE);
      return NextResponse.redirect(new URL(isAdmin ? "/admin" : next, origin));
    }
  }

  // 실패 시 로그인 페이지로 (에러 표시)
  return redirectToLogin(origin, next);
}

function redirectToLogin(origin: string, next: string) {
  const loginUrl = new URL("/login", origin);
  loginUrl.searchParams.set("error", "auth");
  if (next !== "/") {
    loginUrl.searchParams.set("next", next);
  }
  return NextResponse.redirect(loginUrl);
}
