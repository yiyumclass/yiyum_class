import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { lookupPaymentDelivery, type DeliveryTarget } from "../src/lib/messaging/solapi-delivery.ts";

const config = { apiKey: "fake-api-key", apiSecret: "fake-secret", pfId: "channel" };
const now = Date.parse("2026-10-05T12:00:00Z");
const target: DeliveryTarget = { orderUid: "ORD-one", templateId: "template", messageId: "message", groupId: "group", startedAt: new Date(now - 60000).toISOString() };
const message = { messageId: "message", groupId: "group", customFields: { orderId: "ORD-one" }, type: "ATA", replacement: false, kakaoOptions: { pfId: "channel", templateId: "template" }, statusCode: "4000", dateReceived: new Date(now).toISOString() };

function response(change: Record<string, unknown> = {}): typeof fetch {
  return async (input, init) => {
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.body, undefined);
    assert.equal(new URL(String(input)).origin, "https://api.solapi.com");
    assert.match(new Headers(init?.headers).get("authorization")!, /^HMAC-SHA256 /);
    return Response.json({ messageList: { message: { ...message, ...change } }, nextKey: null });
  };
}

test("접수 성공과 카카오 최종 수신 성공은 서로 다른 상태다", async () => {
  assert.equal((await lookupPaymentDelivery(config, target, response(), now)).status, "delivered");
  for (const statusCode of ["2000", "3000"]) {
    assert.equal((await lookupPaymentDelivery(config, target, response({ statusCode }), now)).status, "accepted");
  }
  assert.equal((await lookupPaymentDelivery(config, target, response({ statusCode: "3107" }), now)).status, "delivery_failed");
});

test("다른 주문·채널·템플릿·그룹·SMS 대체 결과로 수신 성공을 판정하지 않는다", async () => {
  for (const change of [
    { customFields: { orderId: "ORD-other" } }, { kakaoOptions: { pfId: "other", templateId: "template" } },
    { kakaoOptions: { pfId: "channel", templateId: "other" } }, { groupId: "other" },
    { type: "SMS" }, { replacement: true },
  ]) {
    assert.equal((await lookupPaymentDelivery(config, target, response(change), now)).status, "review");
  }
});

test("접수 응답이 유실되어도 주문 추적값으로 찾고 재발송하지 않는다", async () => {
  let calls = 0;
  const request: typeof fetch = async (input, init) => {
    calls += 1;
    assert.equal(init?.method, "GET");
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("criteria"), "kakaoTemplateId,type");
    return Response.json({ messageList: { message }, nextKey: null });
  };
  const result = await lookupPaymentDelivery(config, { ...target, messageId: null, groupId: null }, request, now);
  assert.equal(result.status, "delivered");
  assert.equal(result.messageId, "message");
  assert.equal(calls, 1);
});

test("발송 이력 없는 unknown은 실패로 바꿔 재발송하지 않는다", async () => {
  const empty: typeof fetch = async () => Response.json({ messageList: {}, nextKey: null });
  const unknown = { ...target, messageId: null, groupId: null };
  assert.equal((await lookupPaymentDelivery(config, unknown, empty, now)).status, "unknown");
  assert.equal((await lookupPaymentDelivery(config, unknown, empty, now + 86400000)).status, "review");
});

test("처리 완료여도 4000이 아니면 성공 처리하지 않고 미확인 코드는 수동 확인한다", async () => {
  const result = await lookupPaymentDelivery(config, target, response({ status: "COMPLETE", statusCode: "3103" }), now);
  assert.equal(result.status, "delivery_failed");
  assert.equal(result.code, "SOLAPI_3103");
  assert.equal((await lookupPaymentDelivery(config, target, response({ statusCode: "9999" }), now)).status, "review");
  assert.equal((await lookupPaymentDelivery(config, target, response({ statusCode: "3000" }), now + 86400000)).status, "review");
});

test("중복 이력이나 불완전한 페이지를 발견하면 임의로 성공 또는 재발송 처리하지 않는다", async () => {
  const unknown = { ...target, messageId: null, groupId: null };
  const duplicates: typeof fetch = async () => Response.json({ messageList: { first: message, second: { ...message, messageId: "second" } }, nextKey: null });
  assert.equal((await lookupPaymentDelivery(config, unknown, duplicates, now)).code, "MULTIPLE_PROVIDER_MESSAGES");
  let pages = 0;
  const unbounded: typeof fetch = async () => { pages += 1; return Response.json({ messageList: {}, nextKey: `page-${pages}` }); };
  assert.equal((await lookupPaymentDelivery(config, unknown, unbounded, now)).code, "DELIVERY_HISTORY_INCOMPLETE");
  assert.equal(pages, 2);
});

test("조회 API 장애와 응답 손상은 접수 상태를 덮어쓸 성공 결과를 만들지 않는다", async () => {
  for (const request of [async () => new Response(null, { status: 503 }), async () => Response.json({ wrong: true }), async () => { throw new Error("timeout"); }]) {
    await assert.rejects(lookupPaymentDelivery(config, target, request, now));
  }
});

test("백그라운드 작업은 cron 인증과 기능 플래그로 보호되며 조회 CAS를 사용한다", () => {
  const route = readFileSync(new URL("../src/app/api/cron/payment-notifications/route.ts", import.meta.url), "utf8");
  const reconciliation = readFileSync(new URL("../src/lib/messaging/payment-delivery.ts", import.meta.url), "utf8");
  assert.match(route, /!secret \|\| request.headers.get\("authorization"\) !== `Bearer \$\{secret\}`/);
  assert.match(route, /paymentEnabled = process.env.SOLAPI_PAYMENT_NOTIFICATIONS_ENABLED === "true"/);
  assert.match(route, /!paymentEnabled && !adminNotificationsEnabled\(\)/);
  assert.match(route, /if \(!paymentEnabled\)/);
  assert.match(reconciliation, /\.eq\("status", row.status\)\.eq\("updated_at", row.updated_at\)/);
  assert.doesNotMatch(reconciliation, /sendPaymentMessageOnce|requestPayment|cancelToss/);
});
