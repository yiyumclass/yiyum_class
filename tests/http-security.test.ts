import assert from "node:assert/strict";
import test from "node:test";
import {
  isJsonContentType,
  readLimitedJson,
} from "../src/lib/http/request-body.ts";
import { isSameOriginRequest } from "../src/lib/http/origin.ts";
import { normalizeInternalNext } from "../src/lib/auth/redirects.ts";

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
