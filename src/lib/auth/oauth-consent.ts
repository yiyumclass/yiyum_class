import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export const OAUTH_CONSENT_COOKIE = "yiy_oauth_consent";
export const OAUTH_CONSENT_QUERY_PARAM = "signup_intent";
export const AUTH_TERMS_VERSION = "2026-07-24";
export const AUTH_PRIVACY_VERSION = "2026-07-24";
export const AUTH_CONSENT_ENFORCED_AT = "2026-07-24T00:00:00.000Z";

export type OAuthConsentIntent = {
  age14Confirmed: true;
  termsAgreed: true;
  privacyAgreed: true;
  marketingOptIn: boolean;
  issuedAt: number;
};

const INTENT_TTL_SECONDS = 10 * 60;

export function createOAuthConsentCookieValue(marketingOptIn: boolean) {
  const intent: OAuthConsentIntent = {
    age14Confirmed: true,
    termsAgreed: true,
    privacyAgreed: true,
    marketingOptIn,
    issuedAt: Math.floor(Date.now() / 1000),
  };
  const payload = Buffer.from(JSON.stringify(intent)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readOAuthConsentCookieValue(value: string | undefined) {
  if (!value) return null;

  const [payload, signature] = value.split(".");
  if (!payload || !signature || !verify(payload, signature)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<OAuthConsentIntent>;
    const issuedAt = typeof parsed.issuedAt === "number" ? parsed.issuedAt : 0;
    if (Math.floor(Date.now() / 1000) - issuedAt > INTENT_TTL_SECONDS) return null;
    if (
      parsed.age14Confirmed !== true ||
      parsed.termsAgreed !== true ||
      parsed.privacyAgreed !== true ||
      typeof parsed.marketingOptIn !== "boolean"
    ) {
      return null;
    }
    return parsed as OAuthConsentIntent;
  } catch {
    return null;
  }
}

export function oauthConsentCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: INTENT_TTL_SECONDS,
  };
}

function sign(payload: string) {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

function verify(payload: string, signature: string) {
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function getSecret() {
  const secret =
    process.env.AUTH_CONSENT_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.TOSS_SECRET_KEY;

  if (!secret) {
    throw new Error("AUTH_CONSENT_SECRET or another server secret is required.");
  }
  return secret;
}
