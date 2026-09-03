import assert from "node:assert/strict";
import test from "node:test";
import { resolveOAuthConsentGate } from "../src/lib/auth/consent-gate.ts";

const newlyCreatedAt = "2026-08-01T00:00:00.000Z";

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
