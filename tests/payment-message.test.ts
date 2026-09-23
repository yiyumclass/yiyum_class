import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { buildPaymentMessage, deliverPaymentMessage, type PaymentMessageOrder, type PaymentMessagePorts, type PaymentMessageOutcome } from "../src/lib/messaging/payment-message.ts";
import { PaymentMessageRejected, sendPaymentMessageOnce } from "../src/lib/messaging/solapi-payment-transport.ts";

const order: PaymentMessageOrder = {
  order_id: "order-id", order_uid: "ORD-example", user_id: "user-id", product_slug: "sns-monetization",
  amount: 930000, approved_at: "2026-09-22T16:05:06Z", attempt_id: "attempt-id",
};

test("세 클래스는 각 승인 템플릿과 클래스명으로 발송한다", () => {
  const cases = [
    ["sns-monetization", "KA01TP260922040813314fVYjYZjPBWX", "베이직 클래스"],
    ["sns-monetization-feedback", "KA01TP260922041539999n9FFB1w868L", "부스터 클래스"],
    ["sns-monetization-ultra", "KA01TP260922041738461z54SAXgqqVp", "프리미엄 클래스"],
  ];
  for (const [slug, templateId, product] of cases) {
    const result = buildPaymentMessage({ ...order, product_slug: slug }, "홍길동");
    assert.equal(result.templateId, templateId);
    assert.deepEqual(result.variables, {
      "#{name}": "홍길동", "#{product}": product, "#{amount}": "930,000", "#{paymentDate}": "2026.09.23 01:05:06",
    });
  }
});

test("미지원 상품·무료 주문·잘못된 결제일은 발송용 데이터를 만들지 않는다", () => {
  for (const change of [{product_slug: "yiyum-phone-pass"}, {amount: 0}, {amount: -1}, {approved_at: "bad-date"}]) {
    assert.throws(() => buildPaymentMessage({...order, ...change}, "이름"));
  }
  assert.equal(buildPaymentMessage(order, " ").variables["#{name}"], "회원");
});

function fixture(overrides: Partial<PaymentMessagePorts> = {}) {
  const outcomes: PaymentMessageOutcome[] = [];
  const logs: string[] = [];
  let sends = 0;
  const ports: PaymentMessagePorts = {
    prepare: async (o) => ({to: "01000000000", ...buildPaymentMessage(o, "회원")}),
    beginSend: async () => true,
    send: async () => { sends++; return {messageId:"message", groupId:"group"}; },
    finish: async (_, outcome) => {outcomes.push(outcome);},
    isDefiniteRejection: (e) => e instanceof PaymentMessageRejected,
    log: (code) => {logs.push(code);},
    ...overrides,
  };
  return {ports, outcomes, logs, sends: () => sends};
}

test("동시 작업은 발송 직전 원자적 점유에 성공한 하나만 외부 요청한다", async () => {
  let begun = false;
  const f = fixture({beginSend: async () => {if(begun) return false; begun = true; return true;}});
  await Promise.all([deliverPaymentMessage(order, f.ports), deliverPaymentMessage(order, f.ports)]);
  assert.equal(f.sends(), 1);
  assert.equal(f.outcomes[0].status, "accepted");
});

test("연락처 조회 실패는 발송 없이 재시도 가능한 실패로 기록한다", async () => {
  const f = fixture({prepare: async () => {throw new Error("missing phone");}});
  await deliverPaymentMessage(order, f.ports);
  assert.equal(f.sends(), 0);
  assert.equal(f.outcomes[0].status, "failed");
});

test("발송 직전 DB 오류는 재발송 가능한 상태로 임의 변경하지 않는다", async () => {
  const f = fixture({beginSend: async () => {throw new Error("lost response");}});
  await deliverPaymentMessage(order, f.ports);
  assert.equal(f.sends(), 0);
  assert.deepEqual(f.outcomes, []);
  assert.deepEqual(f.logs, ["CLAIM_TRANSITION_FAILED"]);
});

test("확실한 접수 거절과 접수 여부 불명확한 통신 오류를 구분한다", async () => {
  for (const [error, expected] of [[new PaymentMessageRejected(), "failed"], [new Error("timeout"), "unknown"]] as const) {
    const f = fixture({send: async () => {throw error;}});
    await deliverPaymentMessage(order, f.ports);
    assert.equal(f.outcomes[0].status, expected);
  }
});

test("솔라피 접수 후 DB 오류가 발생해도 다시 보내거나 failed로 바꾸지 않는다", async () => {
  const attempts: string[] = [];
  const f = fixture({finish: async (_, outcome) => {attempts.push(outcome.status);throw new Error("DB unavailable");}});
  await deliverPaymentMessage(order, f.ports);
  assert.equal(f.sends(), 1);
  assert.deepEqual(attempts, ["accepted"]);
  assert.deepEqual(f.logs, ["RESULT_PERSIST_FAILED"]);
});

const config = {apiKey: "test-key", apiSecret: "test-secret", pfId: "test-channel"};
const message = {to: "01000000000", orderId: order.order_uid, ...buildPaymentMessage(order, "회원")};
test("실제 발송 없이 HMAC·템플릿 변수·SMS 대체 금지·주문 추적값을 검증한다", async () => {
  const result = await sendPaymentMessageOnce(config, message, async (url, options) => {
    assert.equal(url, "https://api.solapi.com/messages/v4/send-many/detail");
    const headers = options?.headers as Record<string,string>;
    const auth = headers.Authorization;
    const date = /date=([^,]+)/.exec(auth)![1];
    const salt = /salt=([^,]+)/.exec(auth)![1];
    assert.ok(auth.endsWith(createHmac("sha256",config.apiSecret).update(date+salt).digest("hex")));
    const body = JSON.parse(options?.body as string);
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].customFields.orderId, order.order_uid);
    assert.equal(body.messages[0].kakaoOptions.disableSms, true);
    assert.equal(body.messages[0].kakaoOptions.templateId, message.templateId);
    assert.deepEqual(body.messages[0].kakaoOptions.variables, message.variables);
    assert.equal(body.messages[0].kakaoOptions.buttons, undefined);
    return Response.json({failedMessageList:[], messageList:[{messageId:"M1",statusCode:"2000"}],groupInfo:{groupId:"G1"}});
  });
  assert.deepEqual(result,{messageId:"M1",groupId:"G1"});
});

test("타임아웃·서버 오류·불완전한 접수 응답은 HTTP 재시도 없이 종료한다", async () => {
  for (const response of [null, new Response("error",{status:500}), Response.json({})]) {
    let calls=0;
    await assert.rejects(sendPaymentMessageOnce(config,message,async()=>{calls++;if(!response) throw new Error("timeout");return response;}));
    assert.equal(calls,1);
  }
});

test("명시적인 발송 접수 실패만 재시도 가능한 오류로 분류한다", async () => {
  await assert.rejects(sendPaymentMessageOnce(config,message,async()=>Response.json({
    failedMessageList:[{statusCode:"3040"}],messageList:[],groupInfo:{groupId:"G1"},
  })),PaymentMessageRejected);
  await assert.rejects(sendPaymentMessageOnce(config,message,async()=>new Response("denied",{status:401})),PaymentMessageRejected);
});
