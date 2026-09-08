import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readSecurityAccessContext } from "../src/lib/security/access-log-fields.ts";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260818100000_create_security_access_logs.sql",
    import.meta.url
  ),
  "utf8"
);
const loginAction = readFileSync(
  new URL("../src/app/login/actions.ts", import.meta.url),
  "utf8"
);
const authForm = readFileSync(
  new URL("../src/components/auth/AuthForm.tsx", import.meta.url),
  "utf8"
);
const kakaoCallback = readFileSync(
  new URL("../src/app/auth/callback/route.ts", import.meta.url),
  "utf8"
);
const cronRoute = readFileSync(
  new URL("../src/app/api/cron/expire-pending-orders/route.ts", import.meta.url),
  "utf8"
);

test("security access context keeps only a valid proxy IP and bounded headers", () => {
  const values = new Map<string, string>([
    ["x-forwarded-for", "203.0.113.7, 10.0.0.1"],
    ["x-real-ip", "198.51.100.8"],
    ["user-agent", ` Browser\u0000Agent ${"x".repeat(600)}`],
    ["x-vercel-id", `icn1::${"r".repeat(200)}`],
  ]);
  const headers = { get: (name: string) => values.get(name) ?? null };

  const context = readSecurityAccessContext(headers);
  assert.equal(context.ipAddress, "203.0.113.7");
  assert.equal(context.userAgent?.includes("\u0000"), false);
  assert.equal(context.userAgent?.length, 512);
  assert.equal(context.requestId?.length, 128);
});

test("invalid forwarded IP falls back to a valid real IP", () => {
  const context = readSecurityAccessContext(
    new Headers({
      "x-forwarded-for": "spoofed-value",
      "x-real-ip": "2001:db8::1",
    })
  );

  assert.equal(context.ipAddress, "2001:db8::1");
  assert.equal(context.userAgent, null);
  assert.equal(context.requestId, null);
});

test("access log table is server-only, hashes subjects, and fixes retention at three months", () => {
  assert.match(
    migration,
    /revoke all on table public\.security_access_logs from public, anon, authenticated/i
  );
  assert.match(migration, /extensions\.digest\([\s\S]*?'sha256'\)/i);
  assert.match(migration, /event_time \+ interval '3 months'/i);
  assert.match(
    migration,
    /if \(select auth\.role\(\)\) <> 'service_role' then[\s\S]*?service role required/i
  );
  assert.match(
    migration,
    /delete from public\.security_access_logs\s+where retain_until <= clock_timestamp\(\)/i
  );
});

test("email credentials are authenticated only in a server action", () => {
  assert.match(loginAction, /supabase\.auth\.signInWithPassword/);
  assert.match(loginAction, /recordSecurityAccessEvent/);
  assert.match(loginAction, /redirect\(isAdmin \? "\/admin" : nextPath\)/);
  assert.doesNotMatch(authForm, /signInWithPassword/);
  assert.doesNotMatch(authForm, /createClient\(\)/);
  assert.match(authForm, /action=\{emailLoginAction\}/);
});

test("Kakao callback records known success, failure, and consent-blocked outcomes", () => {
  assert.match(kakaoCallback, /"oauth_exchange_failed"/);
  assert.match(kakaoCallback, /if \(hasPkceVerifier\)/);
  assert.doesNotMatch(kakaoCallback, /"authorization_code_missing"/);
  assert.match(kakaoCallback, /"signup_consent_required"/);
  assert.match(kakaoCallback, /"consent_record_failed"/);
  assert.match(kakaoCallback, /"success"/);
});

test("daily cron purges access logs independently of payment configuration", () => {
  assert.match(cronRoute, /purge_expired_security_access_logs_server/);
  assert.match(cronRoute, /securityAccessLogs: \{ purged: accessLogsPurged \}/);
});
