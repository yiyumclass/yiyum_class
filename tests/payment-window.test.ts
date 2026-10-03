import assert from "node:assert/strict";
import test from "node:test";
import type { TossPaymentsWidgets, WidgetSelectedPaymentMethod } from "@tosspayments/tosspayments-sdk";
import { isPaymentCanceled, isPaymentWindowKeyPair, requestTossPaymentWindow } from "../src/lib/payments/payment-window.ts";

function createWindowFixture() {
  const calls: { operation: string; input?: unknown }[] = [];
  let onRequest: ((input: { paymentMethod: WidgetSelectedPaymentMethod }) => Promise<void>) | undefined;
  let onCancel: (() => void) | undefined;
  let completePayment: () => Promise<void> = async () => {};
  const controller = new AbortController();
  const widgets = {
    setAmount: async (input: unknown) => { calls.push({ operation: "amount", input }); },
    renderPaymentWindow: async (input: unknown) => {
      calls.push({ operation: "render", input });
      return {
        on: (event: string, handler: unknown) => {
          if (event === "paymentRequest") onRequest = handler as typeof onRequest;
          if (event === "cancel") onCancel = handler as typeof onCancel;
        },
        destroy: async () => { calls.push({ operation: "destroy" }); },
      };
    },
    requestPayment: async (input: unknown) => {
      calls.push({ operation: "request", input });
      await completePayment();
    },
  } as Pick<TossPaymentsWidgets, "setAmount" | "renderPaymentWindow" | "requestPayment">;
  const request = {
    orderId: "ORD-window-test", orderName: "클래스", customerName: "테스트",
    customerEmail: null, successUrl: "https://example.com/success",
    failUrl: "https://example.com/fail?orderId=ORD-window-test", metadata: { productSlug: "course" },
  };
  return {
    calls, widgets, controller, request,
    start: () => requestTossPaymentWindow({ widgets, amount: 50_000, variantKey: "CARD_ONLY", request, signal: controller.signal }),
    ready: () => new Promise<void>((resolve) => setImmediate(resolve)),
    cancel: () => onCancel?.(),
    pay: (code = "CARD") => onRequest?.({ paymentMethod: { code } }),
    setPayment: (callback: () => Promise<void>) => { completePayment = callback; },
  };
}

test("결제창형은 금액 설정 후 지정 UI를 열고 기존 주문 정보를 전달한다", async () => {
  const fixture = createWindowFixture();
  const pending = fixture.start();
  await fixture.ready();
  assert.deepEqual(fixture.calls, [
    { operation: "amount", input: { currency: "KRW", value: 50_000 } },
    { operation: "render", input: { orderName: "클래스", variantKey: { paymentMethod: "CARD_ONLY" } } },
  ]);
  await fixture.pay();
  await pending;
  assert.deepEqual(fixture.calls.slice(2), [
    { operation: "request", input: fixture.request }, { operation: "destroy" },
  ]);
});

test("팝업 취소는 결제를 요청하지 않고 창을 정리하며 다시 열 수 있다", async () => {
  const fixture = createWindowFixture();
  const pending = fixture.start();
  const rejected = assert.rejects(pending, isPaymentCanceled);
  await fixture.ready();
  fixture.cancel();
  await rejected;
  await fixture.pay();
  assert.equal(fixture.calls.filter((call) => call.operation === "request").length, 0);
  assert.equal(fixture.calls.at(-1)?.operation, "destroy");
  const retry = fixture.start();
  await fixture.ready();
  await fixture.pay();
  await retry;
  assert.equal(fixture.calls.filter((call) => call.operation === "request").length, 1);
});

test("토스 창에서 결제 요청 이벤트가 반복되어도 한 번만 요청한다", async () => {
  const fixture = createWindowFixture();
  let resolvePayment: () => void = () => {};
  fixture.setPayment(() => new Promise<void>((resolve) => { resolvePayment = resolve; }));
  const pending = fixture.start();
  await fixture.ready();
  const firstRequest = fixture.pay();
  await fixture.pay();
  fixture.cancel();
  assert.equal(fixture.calls.filter((call) => call.operation === "request").length, 1);
  assert.equal(fixture.calls.filter((call) => call.operation === "destroy").length, 0);
  resolvePayment();
  await firstRequest;
  await pending;
});

test("어드민 설정이 잘못되어 간편결제가 선택되어도 카드 외 요청은 차단한다", async () => {
  for (const code of ["NAVERPAY", "TOSSPAY", "TRANSFER", "HYUNDAI", "BRANDPAY"]) {
    const fixture = createWindowFixture();
    const rejected = assert.rejects(fixture.start(), { code: "CARD_ONLY" });
    await fixture.ready();
    await fixture.pay(code);
    await rejected;
    assert.equal(fixture.calls.filter((call) => call.operation === "request").length, 0);
    assert.equal(fixture.calls.at(-1)?.operation, "destroy");
  }
});

test("카드사 인증 취소와 SDK 오류도 창을 정리하고 호출자에게 전달한다", async () => {
  for (const code of ["USER_CANCEL", "PAY_PROCESS_CANCELED", "UNAUTHORIZED_KEY"]) {
    const fixture = createWindowFixture();
    fixture.setPayment(async () => { throw Object.assign(new Error("SDK error"), { code }); });
    const rejected = assert.rejects(fixture.start(), { code });
    await fixture.ready();
    await fixture.pay();
    await rejected;
    assert.equal(fixture.calls.at(-1)?.operation, "destroy");
  }
});

test("페이지 이탈 시 팝업을 정리하고 이후 이벤트를 무시한다", async () => {
  const fixture = createWindowFixture();
  const rejected = assert.rejects(fixture.start(), isPaymentCanceled);
  await fixture.ready();
  fixture.controller.abort();
  await rejected;
  await fixture.pay();
  assert.equal(fixture.calls.filter((call) => call.operation === "request").length, 0);
  assert.equal(fixture.calls.at(-1)?.operation, "destroy");
});

test("이미 이탈했거나 금액 설정 중 이탈하면 팝업을 열지 않는다", async () => {
  const fixture = createWindowFixture();
  fixture.controller.abort();
  await assert.rejects(fixture.start(), isPaymentCanceled);
  assert.equal(fixture.calls.length, 0);
  const duringSetup = createWindowFixture();
  duringSetup.widgets.setAmount = async () => { duringSetup.controller.abort(); };
  await assert.rejects(duringSetup.start(), isPaymentCanceled);
  assert.equal(duringSetup.calls.length, 0);
});

test("UI 키 또는 주문 금액이 없으면 SDK를 호출하지 않는다", async () => {
  const fixture = createWindowFixture();
  for (const [amount, variantKey] of [[0, "CARD_ONLY"], [NaN, "CARD_ONLY"], [1.5, "CARD_ONLY"], [50_000, " "]] as const) {
    await assert.rejects(requestTossPaymentWindow({ widgets: fixture.widgets, amount, variantKey, request: fixture.request, signal: fixture.controller.signal }));
  }
  assert.equal(fixture.calls.length, 0);
});

test("렌더링 중 페이지를 떠나도 늦게 생성된 팝업을 정리한다", async () => {
  const fixture = createWindowFixture();
  const render = fixture.widgets.renderPaymentWindow;
  fixture.widgets.renderPaymentWindow = async (input) => {
    const paymentWindow = await render(input);
    fixture.controller.abort();
    return paymentWindow;
  };
  await assert.rejects(fixture.start(), isPaymentCanceled);
  assert.equal(fixture.calls.at(-1)?.operation, "destroy");
  assert.equal(fixture.calls.filter((call) => call.operation === "request").length, 0);
});

test("결제 모드와 일치하는 결제창형 키만 허용한다", () => {
  assert.equal(isPaymentWindowKeyPair("test_gck_example", "test_gsk_example", "toss_test"), true);
  assert.equal(isPaymentWindowKeyPair("live_gck_example", "live_gsk_example", "toss_live"), true);
  for (const keys of [
    ["test_ck_example", "test_sk_example", "toss_test"],
    ["test_gck_example", "test_sk_example", "toss_test"],
    ["test_gck_example", "live_gsk_example", "toss_test"],
    ["test_gck_example", "test_gsk_example", "toss_live"],
    ["live_gck_example", "live_gsk_example", "free"],
    ["test_gck_", "test_gsk_", "toss_test"],
    ["", "", "toss_test"],
  ]) {
    assert.equal(isPaymentWindowKeyPair(keys[0], keys[1], keys[2]), false);
  }
});
