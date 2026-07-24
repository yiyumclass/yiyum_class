import { NextResponse } from "next/server";
import {
  createOAuthConsentCookieValue,
  oauthConsentCookieOptions,
  OAUTH_CONSENT_COOKIE,
} from "@/lib/auth/oauth-consent";
import { normalizeInternalNext } from "@/lib/auth/redirects";
import { isSameOriginRequest } from "@/lib/http/origin";
import { readLimitedJson } from "@/lib/http/request-body";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const START_BODY_LIMIT_BYTES = 2 * 1024;

type StartPayload = {
  mode?: unknown;
  next?: unknown;
  age14?: unknown;
  terms?: unknown;
  privacy?: unknown;
  marketing?: unknown;
};

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return json({ ok: false, message: "요청 출처를 확인하지 못했습니다." }, 403);
  }

  const parsed = await readLimitedJson(request, {
    limitBytes: START_BODY_LIMIT_BYTES,
  });
  if (!parsed.ok || !isRecord(parsed.value)) {
    return json({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }

  const payload = parsed.value as StartPayload;
  const mode = payload.mode === "signup" ? "signup" : "login";
  const next = normalizeInternalNext(
    typeof payload.next === "string" ? payload.next : null
  );
  const redirectTo = new URL("/auth/callback", request.url);
  redirectTo.searchParams.set("next", next);

  if (mode === "signup") {
    const hasRequiredConsent =
      payload.age14 === true &&
      payload.terms === true &&
      payload.privacy === true;
    if (!hasRequiredConsent) {
      return json({ ok: false, message: "필수 항목에 동의해 주세요." }, 400);
    }
  }

  const oauthUrl = await createOAuthUrl(redirectTo.toString());
  if (!oauthUrl) {
    return json({ ok: false, message: "카카오 로그인을 시작하지 못했습니다." }, 503);
  }

  const response = json({ ok: true, url: oauthUrl }, 200);
  if (mode === "signup") {
    response.cookies.set(
      OAUTH_CONSENT_COOKIE,
      createOAuthConsentCookieValue(payload.marketing === true),
      oauthConsentCookieOptions()
    );
  } else {
    response.cookies.delete(OAUTH_CONSENT_COOKIE);
  }

  return response;
}

async function createOAuthUrl(redirectTo: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "kakao",
    options: { redirectTo },
  });

  if (error || !data.url) return null;
  return data.url;
}

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
