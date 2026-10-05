import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { ModuleKind, transpileModule } from "typescript";
import * as crypto from "node:crypto";
import * as templateUtilities from "../src/lib/messaging/admin-notification-template.ts";
import { paymentTemplateProductSlug } from "../src/lib/messaging/payment-message.ts";
import { sendAdminNotificationOnce } from "../src/lib/messaging/admin-notification-send.ts";
import type { NotificationPreview, NotificationPreviewInput } from "../src/lib/messaging/admin-notification-types.ts";

const owner = "10000000-0000-0000-0000-000000000002";
const member = "10000000-0000-0000-0000-000000000001";
const entitlementId = "20000000-0000-0000-0000-000000000001";
const templateId = "KA01TP260922041539999n9FFB1w868L";

function setEnvironment(context: TestContext) {
  const previous = { ...process.env };
  context.after(() => { process.env = previous; });
  Object.assign(process.env, { SOLAPI_API_KEY: "fake", SOLAPI_API_SECRET: "fake", SOLAPI_PF_ID: "fake", SOLAPI_ADMIN_NOTIFICATIONS_ENABLED: "true", CRON_SECRET: "fake-cron" });
}

function loadModule(path: string, modules: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } });
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", compiled.outputText)((name: string) => { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; }, exports);
  return exports;
}

function harness() {
  const settings = { phone: "01012345678", consent: true, fingerprint: "one", source: "admin_grant", previous: false, paid: false, withdrawn: false, expire: false };
  const writes: { table: string; row: Record<string, unknown> }[] = [];
  let stored: Record<string, unknown> | null = null;
  let sends = 0;
  let begins = 0;
  let lookups = 0;
  const template = {
    id: templateId, name: "부스터 안내", content: "#{name} #{product} #{amount}원 #{paymentDate}", extra: "",
    title: "수강 안내", subtitle: "클래스", buttons: [], variables: ["#{amount}", "#{name}", "#{paymentDate}", "#{product}"], fingerprint: "one",
  };
  const admin = {
    auth: { admin: { getUserById: async () => ({ data: { user: { id: member, identities: [{ provider: "kakao", id: "123" }] } }, error: null }) } },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let operation = "read";
      let payload: Record<string, unknown> = {};
      let single = false;
      const query = {
        select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; },
        neq(key: string, value: unknown) { filters[`not.${key}`] = value; return query; },
        limit() { return query; }, order() { return query; }, or() { return query; }, returns() { return query; },
        maybeSingle() { single = true; return query; },
        insert(row: Record<string, unknown>) { operation = "insert"; payload = row; return query; },
        update(row: Record<string, unknown>) { operation = "update"; payload = row; return query; },
        then(resolve: (value: unknown) => unknown) {
          if (operation !== "read") {
            writes.push({ table, row: payload });
            assert.equal(table, "admin_notifications");
            stored = operation === "insert" ? { status: "draft", ...payload } : { ...stored, ...payload };
            return Promise.resolve(resolve({ data: [{ id: stored.id }], error: null }));
          }
          let data: unknown = [];
          if (table === "account_withdrawals") data = settings.withdrawn ? { user_id: member } : null;
          if (table === "product_entitlements") data = [{ id: entitlementId, product_id: "product", source: settings.source, expires_at: settings.expire ? "2000-01-01" : null, products: { title: "부스터 클래스", slug: "sns-monetization-feedback" } }];
          if (table === "orders") data = settings.paid ? [{ id: "paid" }] : [];
          if (table === "admin_notifications") {
            data = single ? stored && stored.actor_user_id === filters.actor_user_id ? stored : null
              : stored && stored.status !== "draft" ? [stored] : [];
          }
          return Promise.resolve(resolve({ data, error: null }));
        },
      };
      return query;
    },
    async rpc(name: string, input: Record<string, unknown>) {
      assert.equal(name, "begin_admin_notification_send");
      assert.equal(input.actor_id, owner);
      begins += 1;
      if (!stored || stored.status !== "draft") return { data: false, error: null };
      stored.status = "sending";
      return { data: true, error: null };
    },
  };
  const service = loadModule("../src/lib/messaging/admin-notifications.ts", {
    "server-only": {}, "node:crypto": crypto,
    "@/lib/supabase/admin": { getAdminClient: () => admin },
    "@/lib/auth/account-withdrawal": { readKakaoUserId: () => "123" },
    "@/lib/auth/kakao-phone-request": { lookupKakaoPhone: async () => { lookups += 1; return settings.consent ? { ok: true, phone: settings.phone } : { ok: false, code: "PHONE_CONSENT_REQUIRED" }; } },
    "./profile": { readAuthUserDisplayName: () => "실제회원" },
    "./admin-notification-template": templateUtilities,
    "./payment-message": { paymentTemplateProductSlug },
    "./solapi-admin-templates": { getAdminTemplate: async () => ({ ...template, fingerprint: settings.fingerprint }), hasPreviousTemplateMessage: async () => settings.previous },
    "./solapi-payment-transport": { sendPaymentMessageOnce: async (_config: unknown, message: Record<string, unknown>) => {
      assert.equal(message.to, settings.phone); assert.match(String(message.orderId), /^ADMIN-/);
      sends += 1; return { messageId: "message", groupId: "group" };
    } },
    "./admin-notification-send": { sendAdminNotificationOnce },
    "./solapi-delivery": {},
  }) as {
    previewAdminNotification: (actor: string, input: NotificationPreviewInput) => Promise<NotificationPreview>;
    confirmAdminNotification: (actor: string, id: string) => Promise<string>;
  };
  const input: NotificationPreviewInput = { memberId: member, templateId, entitlementId, variables: {
    "#{name}": "변조한 이름", "#{product}": "변조한 상품", "#{amount}": "1200000", "#{paymentDate}": "2026-10-05",
  } };
  return { service, settings, writes, input, sends: () => sends, begins: () => begins, lookups: () => lookups, stored: () => stored! };
}

test("서버 미리보기·확정은 원장 불변·자동값 검증·마스킹·최신 재검증·1회 발송을 지킨다", async context => {
  setEnvironment(context);
  const state = harness();
  const preview = await state.service.previewAdminNotification(owner, state.input);
  assert.match(preview.content, /실제회원 부스터 클래스 1,200,000원 2026.10.05/);
  assert.equal(preview.maskedPhone, "010-****-5678");
  assert.equal(state.sends(), 0);
  assert.equal(JSON.stringify(state.writes).includes(state.settings.phone), false);
  assert.equal(await state.service.confirmAdminNotification(owner, preview.id), "accepted");
  assert.equal(state.lookups(), 2);
  assert.equal(state.sends(), 1);
  assert.equal(await state.service.confirmAdminNotification(owner, preview.id), "already_started");
  assert.equal(state.sends(), 1);
  assert.ok(state.writes.every(write => write.table === "admin_notifications"));
});

test("미리보기 이후 번호·템플릿·수강권·동의·계정·기존이력 변경은 모두 발송 전에 차단한다", async context => {
  setEnvironment(context);
  for (const change of [{ phone: "01087654321" }, { fingerprint: "changed" }, { source: "payment" }, { consent: false }, { withdrawn: true }, { expire: true }, { previous: true }, { paid: true }]) {
    const state = harness();
    const preview = await state.service.previewAdminNotification(owner, state.input);
    Object.assign(state.settings, change);
    await assert.rejects(state.service.confirmAdminNotification(owner, preview.id));
    assert.equal(state.sends(), 0);
    assert.equal(state.begins(), 0);
  }
});

test("기능 비활성·다른 owner의 draft·만료 draft는 실제 발송하지 않는다", async context => {
  setEnvironment(context);
  process.env.SOLAPI_ADMIN_NOTIFICATIONS_ENABLED = "false";
  const state = harness();
  const preview = await state.service.previewAdminNotification(owner, state.input);
  await assert.rejects(state.service.confirmAdminNotification(owner, preview.id), /ADMIN_NOTIFICATIONS_DISABLED/);
  process.env.SOLAPI_ADMIN_NOTIFICATIONS_ENABLED = "true";
  await assert.rejects(state.service.confirmAdminNotification(member, preview.id), /DRAFT_UNAVAILABLE/);
  state.stored().expires_at = "2000-01-01";
  await assert.rejects(state.service.confirmAdminNotification(owner, preview.id), /PREVIEW_EXPIRED/);
  assert.equal(state.sends(), 0);
});

test("cron의 관리자 조회 장애가 기존 결제 작업을 생략시키지 않고 인증·플래그를 지킨다", async context => {
  setEnvironment(context);
  let sends = 0;
  let checks = 0;
  let enabled = false;
  let fail = false;
  const route = loadModule("../src/app/api/cron/payment-notifications/route.ts", {
    "@/lib/messaging/payment-notifications": { dispatchPaymentNotification: async () => { sends += 1; return true; } },
    "@/lib/messaging/payment-delivery": { reconcilePaymentNotificationDeliveries: async () => 1 },
    "@/lib/supabase/admin": { getAdminClient: () => ({ rpc: async () => ({ data: [{ attention_count: 0 }], error: null }) }) },
    "@/lib/messaging/admin-notifications": { adminNotificationsEnabled: () => enabled, reconcileAdminNotificationDeliveries: async () => { if (!enabled) return 0; checks += 1; if (fail) throw new Error("offline"); return 1; } },
  }) as { GET: (request: Request) => Promise<Response> };
  context.mock.method(console, "error", () => undefined);
  assert.equal((await route.GET(new Request("https://example.test"))).status, 401);
  assert.equal(checks, 0);
  process.env.SOLAPI_PAYMENT_NOTIFICATIONS_ENABLED = "false";
  const request = () => new Request("https://example.test", { headers: { authorization: "Bearer fake-cron" } });
  assert.equal((await route.GET(request())).status, 200);
  assert.equal(sends, 0);
  assert.equal(checks, 0);
  enabled = true;
  assert.equal((await route.GET(request())).status, 200);
  assert.equal(sends, 0);
  assert.equal(checks, 1);
  process.env.SOLAPI_PAYMENT_NOTIFICATIONS_ENABLED = "true";
  fail = true;
  assert.equal((await route.GET(request())).status, 503);
  assert.equal(sends, 3);
});
