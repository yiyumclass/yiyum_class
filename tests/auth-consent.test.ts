import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveOAuthConsentGate } from "../src/lib/auth/consent-gate.ts";

const newlyCreatedAt = "2026-08-01T00:00:00.000Z";
const kakaoStartRoute = readFileSync(
  new URL("../src/app/auth/kakao/start/route.ts", import.meta.url),
  "utf8"
);
const authCallbackRoute = readFileSync(
  new URL("../src/app/auth/callback/route.ts", import.meta.url),
  "utf8"
);
const signupPage = readFileSync(
  new URL("../src/app/signup/page.tsx", import.meta.url),
  "utf8"
);

test("비관리자는 약관 동의 조회 실패 시 OAuth 세션을 계속하지 않는다", () => {
  assert.equal(
    resolveOAuthConsentGate({
      isAdmin: false,
      userCreatedAt: newlyCreatedAt,
      existingConsent: false,
      consentIntent: false,
      consentLookupFailed: true,
    }),
    "unavailable"
  );
});

test("관리자는 약관 조회 장애와 관계없이 기존 관리자 흐름을 유지한다", () => {
  assert.equal(
    resolveOAuthConsentGate({
      isAdmin: true,
      userCreatedAt: newlyCreatedAt,
      existingConsent: false,
      consentIntent: false,
      consentLookupFailed: true,
    }),
    "allow"
  );
});

test("신규 비관리자는 동의 기록과 동의 의도가 없으면 동의를 요구한다", () => {
  assert.equal(
    resolveOAuthConsentGate({
      isAdmin: false,
      userCreatedAt: newlyCreatedAt,
      existingConsent: false,
      consentIntent: false,
      consentLookupFailed: false,
    }),
    "require"
  );
});

test("기존 동의 기록 또는 서명된 동의 의도가 있으면 진행한다", () => {
  assert.equal(
    resolveOAuthConsentGate({
      isAdmin: false,
      userCreatedAt: newlyCreatedAt,
      existingConsent: true,
      consentIntent: false,
      consentLookupFailed: false,
    }),
    "allow"
  );
  assert.equal(
    resolveOAuthConsentGate({
      isAdmin: false,
      userCreatedAt: newlyCreatedAt,
      existingConsent: false,
      consentIntent: true,
      consentLookupFailed: false,
    }),
    "allow"
  );
});

test("카카오 로그인은 남아 있는 카카오 세션을 자동 재사용하지 않는다", () => {
  assert.match(
    kakaoStartRoute,
    /queryParams:\s*mode === "login" \? \{ prompt: "login" \} : undefined/
  );
});

test("가입 미완료 계정은 오류가 아닌 명확한 가입 안내로 이동한다", () => {
  assert.match(
    authCallbackRoute,
    /searchParams\.set\("notice", "signup_required"\)/
  );
  assert.doesNotMatch(
    authCallbackRoute,
    /searchParams\.set\("error", "consent"\)/
  );
  assert.match(signupPage, /authNoticeCode === "signup_required"/);
  assert.match(signupPage, /카카오 회원가입이 아직 완료되지 않았어요/);
});
