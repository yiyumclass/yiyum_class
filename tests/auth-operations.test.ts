import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
function load<T>(path: string, dependencies: Record<string, unknown>, env = {}) {
  const exports = {};
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, URL, Buffer, Date, Response, process: { env }, console: { error() {} },
    require: (name: string) => {
      if (name in dependencies) return dependencies[name];
      if (name.startsWith("node:")) return nodeRequire(name);
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports as T;
}

test("최고관리자 권한 검사 실패 시 서비스 권한 DB 조회에 도달하지 않는다", async () => {
  let queried = false;
  const subjectModule = load<{ loadPrivacyOperations: (a: number, b: number) => Promise<unknown> }>("lib/admin/privacy.ts", {
    "server-only": {},
    "@/lib/admin/auth": { requireOwnerAdmin: async () => { throw new Error("denied"); } },
    "@/lib/supabase/admin": { getAdminClient: () => { queried = true; } },
  });
  await assert.rejects(subjectModule.loadPrivacyOperations(1, 1), /denied/);
  assert.equal(queried, false);
});

for (const scenario of ["member", "admin", "withdrawn", "invalid", "network"] as const) {
  test(`이메일 로그인 실제 분기: ${scenario}`, async () => {
    const events: Array<{ outcome: string }> = [];
    const subjectModule = load<{ loginWithEmailAction: (s: object, f: FormData) => Promise<{message: string}> }>("app/login/actions.ts", {
      "next/headers": { headers: async () => new Headers() },
      "next/navigation": { redirect: (url: string) => { throw new Error(`redirect:${url}`); } },
      "@/lib/admin/access": { hasActiveAdminAccess: async () => scenario === "admin" },
      "@/lib/auth/redirects": { normalizeInternalNext: () => "/my" },
      "@/lib/security/access-log": { recordSecurityAccessEvent: async (event: {outcome: string}) => events.push(event) },
      "@/lib/supabase/account-status": { hasActiveAccount: async () => scenario !== "withdrawn" },
      "@/lib/supabase/server": { createClient: async () => ({ auth: { signInWithPassword: async () => {
        if (scenario === "network") throw new Error("offline");
        return scenario === "invalid"
          ? { data: {}, error: { code: "invalid_credentials" } }
          : { data: { user: { id: "test-user" } }, error: null };
      } } }) },
    });
    const form = new FormData(); form.set("email", "test@example.com"); form.set("password", "test-password");
    if (scenario === "invalid" || scenario === "network") {
      const result = await subjectModule.loginWithEmailAction({}, form);
      assert.ok(result.message);
      assert.equal(events.length, scenario === "invalid" ? 1 : 0);
    } else {
      const target = scenario === "admin" ? "/admin" : scenario === "withdrawn" ? "/account/settings" : "/my";
      await assert.rejects(subjectModule.loginWithEmailAction({}, form), { message: `redirect:${target}` });
      assert.equal(events[0].outcome, scenario === "withdrawn" ? "blocked" : "success");
    }
  });
}

test("로그인 기록 DB 장애는 호출자에게 예외를 전파하지 않는다", async () => {
  const subjectModule = load<{recordSecurityAccessEvent: (e: object) => Promise<boolean>}>("lib/security/access-log.ts", {
    "server-only": {},
    "./access-log-fields": { readSecurityAccessContext: () => ({}) },
    "@/lib/supabase/admin": { getAdminClient: () => { throw new Error("offline"); } },
  });
  assert.equal(await subjectModule.recordSecurityAccessEvent({provider: "email", outcome: "success", headers: new Headers()}), false);
});

test("서명된 동의는 변조·미래 발급·만료·추가 토큰을 거부한다", () => {
  const secret = "test-consent-secret";
  const subjectModule = load<{createOAuthConsentCookieValue: (b: boolean) => string; readOAuthConsentCookieValue: (v: string) => unknown}>("lib/auth/oauth-consent.ts", {
    "server-only": {}, "./consent-gate": {},
  }, { AUTH_CONSENT_SECRET: secret });
  const token = subjectModule.createOAuthConsentCookieValue(false);
  assert.ok(subjectModule.readOAuthConsentCookieValue(token));
  assert.equal(subjectModule.readOAuthConsentCookieValue(token + ".extra"), null);
  assert.equal(subjectModule.readOAuthConsentCookieValue("changed." + token.split(".")[1]), null);
  const original = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
  for (const offset of [-601, 120]) {
    const payload = Buffer.from(JSON.stringify({ ...original, issuedAt: Math.floor(Date.now()/1000) + offset })).toString("base64url");
    const signature = nodeRequire("node:crypto").createHmac("sha256", secret).update(payload).digest("base64url");
    assert.equal(subjectModule.readOAuthConsentCookieValue(`${payload}.${signature}`), null);
  }
});

test("결제 미설정 상태에서도 로그 파기 실행, 인증 없는 cron은 DB에 접근하지 않는다", async () => {
  const calls: string[] = [];
  const subjectModule = load<{GET: (r: Request) => Promise<Response>}>("app/api/cron/expire-pending-orders/route.ts", {
    "next/cache": { revalidatePath() {} },
    "@/lib/store/free-enrollment": { isTossPaymentConfigured: () => false },
    "@/lib/supabase/admin": { getAdminClient: () => ({ rpc: async (name: string) => { calls.push(name); return {data: 2, error: null}; } }) },
  }, { CRON_SECRET: "test-cron" });
  assert.equal((await subjectModule.GET(new Request("https://example.com/cron"))).status, 401);
  assert.equal(calls.length, 0);
  const response = await subjectModule.GET(new Request("https://example.com/cron", {headers: {authorization: "Bearer test-cron"}}));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["purge_expired_security_access_logs_server"]);
  assert.equal((await response.json()).securityAccessLogs.purged, 2);
});
