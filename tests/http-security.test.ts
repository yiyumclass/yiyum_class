import assert from "node:assert/strict";
import test from "node:test";
import {
  isJsonContentType,
  readLimitedJson,
} from "../src/lib/http/request-body.ts";
import { isSameOriginRequest } from "../src/lib/http/origin.ts";
import { normalizeInternalNext } from "../src/lib/auth/redirects.ts";
import { buildContentSecurityPolicy } from "../src/lib/http/content-security-policy.ts";
import { FixedWindowRateLimiter } from "../src/lib/http/fixed-window-rate-limiter.ts";

test("JSON content types are accepted without accepting arbitrary text", () => {
  assert.equal(isJsonContentType("application/json"), true);
  assert.equal(isJsonContentType("application/problem+json; charset=utf-8"), true);
  assert.equal(isJsonContentType("text/plain"), false);
  assert.equal(isJsonContentType(null), false);
});

test("bounded JSON reader rejects oversized and malformed payloads", async () => {
  const oversized = await readLimitedJson(
    new Request("https://example.com/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(40) }),
    }),
    { limitBytes: 16 }
  );
  assert.deepEqual(oversized, {
    ok: false,
    status: 413,
    code: "BODY_TOO_LARGE",
  });

  const malformed = await readLimitedJson(
    new Request("https://example.com/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }),
    { limitBytes: 16 }
  );
  assert.deepEqual(malformed, {
    ok: false,
    status: 400,
    code: "INVALID_JSON",
  });
});

test("state-changing browser requests require an exact same origin", () => {
  const sameOrigin = new Request("https://class.example/api", {
    method: "POST",
    headers: { origin: "https://class.example" },
  });
  const crossOrigin = new Request("https://class.example/api", {
    method: "POST",
    headers: { origin: "https://evil.example" },
  });
  const missingOrigin = new Request("https://class.example/api", {
    method: "POST",
  });

  assert.equal(isSameOriginRequest(sameOrigin), true);
  assert.equal(isSameOriginRequest(crossOrigin), false);
  assert.equal(isSameOriginRequest(missingOrigin), false);
});

test("post-login redirects remain internal", () => {
  assert.equal(normalizeInternalNext("/my?tab=orders"), "/my?tab=orders");
  assert.equal(normalizeInternalNext("//evil.example"), "/");
  assert.equal(normalizeInternalNext("/\\evil.example"), "/");
  assert.equal(normalizeInternalNext("https://evil.example"), "/");
  assert.equal(normalizeInternalNext("/auth/callback?next=/admin"), "/");
});

test("production CSP nonces style elements while limiting unsafe-inline to style attributes", () => {
  const policy = buildContentSecurityPolicy({
    nonce: "test-nonce",
    isDevelopment: false,
    supabaseUrl: "https://project.supabase.co/rest/v1",
  });
  const directives = new Map(
    policy.split("; ").map((directive) => {
      const [name, ...values] = directive.split(" ");
      return [name, values];
    })
  );

  assert.deepEqual(directives.get("style-src-attr"), ["'unsafe-inline'"]);
  assert.equal(directives.get("style-src")?.includes("'unsafe-inline'"), false);
  assert.equal(directives.get("style-src")?.includes("'nonce-test-nonce'"), true);
  assert.equal(directives.get("script-src")?.includes("'unsafe-eval'"), false);
  assert.equal(directives.has("upgrade-insecure-requests"), true);
  assert.equal(directives.get("connect-src")?.includes("https://project.supabase.co"), true);
});

test("webhook limiter checks combined rules atomically and resets after its window", () => {
  const limiter = new FixedWindowRateLimiter(1_000, 10);
  const rules = [
    { key: "ip:127.0.0.1", limit: 3 },
    { key: "payment:key", limit: 2 },
  ];

  assert.equal(limiter.allows(rules, 0), true);
  assert.equal(limiter.allows(rules, 1), true);
  assert.equal(limiter.allows(rules, 2), false);

  // 거절된 세 번째 요청은 IP 버킷을 소모하지 않는다.
  assert.equal(
    limiter.allows(
      [
        { key: "ip:127.0.0.1", limit: 3 },
        { key: "payment:other", limit: 2 },
      ],
      3
    ),
    true
  );
  assert.equal(limiter.allows(rules, 1_001), true);
});

test("webhook limiter keeps its in-memory bucket count bounded", () => {
  const limiter = new FixedWindowRateLimiter(10_000, 4);

  for (let index = 0; index < 20; index += 1) {
    assert.equal(
      limiter.allows(
        [
          { key: "ip:127.0.0.1", limit: 100 },
          { key: `payment:${index}`, limit: 1 },
        ],
        index
      ),
      true
    );
  }

  assert.equal(limiter.size, 4);
});
