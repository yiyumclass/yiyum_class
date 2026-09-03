import { after, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hasActiveAdminAccess } from "@/lib/admin/access";
import {
  AUTH_PRIVACY_VERSION,
  AUTH_TERMS_VERSION,
  OAUTH_CONSENT_COOKIE,
  readOAuthConsentCookieValue,
} from "@/lib/auth/oauth-consent";
import { resolveOAuthConsentGate } from "@/lib/auth/consent-gate";
import { normalizeInternalNext } from "@/lib/auth/redirects";
import { sendSignupWelcomeMessage } from "@/lib/messaging/solapi";
import { hasActiveAccount } from "@/lib/supabase/account-status";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

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
      if (!(await hasActiveAccount(supabase))) {
        return NextResponse.redirect(new URL("/account/settings", origin));
      }

      const consentIntent = readOAuthConsentCookieValue(
        cookieStore.get(OAUTH_CONSENT_COOKIE)?.value
      );
      const isAdmin = await hasActiveAdminAccess(supabase, user.id);
      const { data: existingConsent, error: consentLookupError } = await supabase
        .from("user_auth_consents")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle<{ user_id: string }>();
      if (consentLookupError) {
        console.error(
          "Failed to look up auth consent; blocking OAuth session:",
          consentLookupError.code
        );
      }
      const isNewSignup =
        Boolean(consentIntent) &&
        !existingConsent &&
        isRecentlyCreated(user.created_at);
      const consentGate = resolveOAuthConsentGate({
        isAdmin,
        userCreatedAt: user.created_at,
        existingConsent: Boolean(existingConsent),
        consentIntent: Boolean(consentIntent),
        consentLookupFailed: Boolean(consentLookupError),
      });
      if (consentGate === "unavailable") {
        await supabase.auth.signOut({ scope: "local" });
        cookieStore.delete(OAUTH_CONSENT_COOKIE);
        return redirectToAuthUnavailable(origin, next, Boolean(consentIntent));
      }
      if (consentGate === "require") {
        await supabase.auth.signOut({ scope: "local" });
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
          await supabase.auth.signOut({ scope: "local" });
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
      if (isNewSignup) {
        after(async () => {
          try {
            const result = await sendSignupWelcomeMessage(user);
            if (result.status === "skipped") {
              console.warn(
                "Skipped SOLAPI signup welcome message:",
                result.reason
              );
            }
          } catch (error) {
            console.error(
              "Failed to send SOLAPI signup welcome message:",
              readErrorCode(error)
            );
          }
        });
      }
      return NextResponse.redirect(new URL(isAdmin ? "/admin" : next, origin));
    }
  }

  // 실패 시 로그인 페이지로 (에러 표시)
  return redirectToLogin(origin, next);
}

function isRecentlyCreated(createdAt: string) {
  const createdAtMs = new Date(createdAt).getTime();
  const ageMs = Date.now() - createdAtMs;
  return Number.isFinite(createdAtMs) && ageMs >= 0 && ageMs <= 15 * 60 * 1000;
}

function readErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "unknown_error";
  const candidate = error as {
    code?: unknown;
    statusCode?: unknown;
    name?: unknown;
  };
  for (const value of [candidate.code, candidate.statusCode, candidate.name]) {
    if (typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value)) return value;
  }
  return "unknown_error";
}

function redirectToLogin(origin: string, next: string) {
  const loginUrl = new URL("/login", origin);
  loginUrl.searchParams.set("error", "auth");
  if (next !== "/") {
    loginUrl.searchParams.set("next", next);
  }
  return NextResponse.redirect(loginUrl);
}

function redirectToAuthUnavailable(origin: string, next: string, isSignup: boolean) {
  const authUrl = new URL(isSignup ? "/signup" : "/login", origin);
  authUrl.searchParams.set("error", "auth_unavailable");
  if (next !== "/") {
    authUrl.searchParams.set("next", next);
  }
  return NextResponse.redirect(authUrl);
}
