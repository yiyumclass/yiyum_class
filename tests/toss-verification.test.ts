import assert from "node:assert/strict";
import test from "node:test";
import {
  canSettleCancellation,
  isActiveEntitlement,
  isMatchingCompletedPayment,
  isSupportedPaymentStatus,
  parseConfirmRequest,
  readPaymentEvent,
  resolveFullCancellation,
  resolveLatestCompletedCancellation,
  type TossCancellation,
  type TossPayment,
} from "../src/lib/payments/toss-verification.ts";

const ORDER_UID = "ORD-20260722-8cfe3cc6e5dc4f20a63b4e276381520a".slice(0, 64);
const PAYMENT_KEY = "test_payment_key_123";

function cancellation(overrides: Partial<TossCancellation> = {}): TossCancellation {
  return {
    cancelAmount: 300000,
    cancelReason: "고객 요청",
    canceledAt: "2026-07-25T10:00:00Z",
    transactionKey: "txn-1",
    cancelStatus: "DONE",
    ...overrides,
  };
}

function payment(overrides: Partial<TossPayment> = {}): TossPayment {
  return {
    paymentKey: PAYMENT_KEY,
    orderId: ORDER_UID,
    status: "DONE",
    totalAmount: 300000,
    balanceAmount: 300000,
    approvedAt: "2026-07-22T10:00:00Z",
    method: "카드",
    cancels: [],
    ...overrides,
  };
}

// --- 승인 요청 본문 검증 ---

test("정상적인 승인 요청을 통과시킨다", () => {
  assert.deepEqual(
    parseConfirmRequest({
      paymentKey: PAYMENT_KEY,
      orderId: ORDER_UID,
      amount: 300000,
    }),
    { paymentKey: PAYMENT_KEY, orderId: ORDER_UID, amount: 300000 }
  );
});

test("금액이 정수 양수가 아니면 승인 요청을 거절한다", () => {
  for (const amount of [0, -1000, 1000.5, "300000", null, undefined, NaN]) {
    assert.equal(
      parseConfirmRequest({ paymentKey: PAYMENT_KEY, orderId: ORDER_UID, amount }),
      null,
      `amount=${String(amount)}는 거절돼야 한다`
    );
  }
});

test("주문번호 형식이 어긋나면 승인 요청을 거절한다", () => {
  for (const orderId of ["짧음", "a".repeat(65), "has space", "has/slash", ""]) {
    assert.equal(
      parseConfirmRequest({ paymentKey: PAYMENT_KEY, orderId, amount: 300000 }),
      null,
      `orderId=${orderId}는 거절돼야 한다`
    );
  }
});

test("결제키가 비었거나 지나치게 길면 거절한다", () => {
  for (const paymentKey of ["", "k".repeat(201)]) {
    assert.equal(
      parseConfirmRequest({ paymentKey, orderId: ORDER_UID, amount: 300000 }),
      null
    );
  }
});

test("본문이 객체가 아니면 거절한다", () => {
  for (const value of [null, undefined, "string", 42, [1, 2, 3]]) {
    assert.equal(parseConfirmRequest(value), null);
  }
});

// --- 승인 응답 대조 ---

test("요청과 완전히 일치하는 승인 응답만 받아들인다", () => {
  const input = { paymentKey: PAYMENT_KEY, orderId: ORDER_UID, amount: 300000 };
  assert.equal(isMatchingCompletedPayment(payment(), input), true);
});

test("승인 응답의 값이 하나라도 어긋나면 거절한다", () => {
  const input = { paymentKey: PAYMENT_KEY, orderId: ORDER_UID, amount: 300000 };

  // 금액 위변조 — 가장 위험한 시나리오
  assert.equal(
    isMatchingCompletedPayment(payment({ totalAmount: 1000 }), input),
    false,
    "승인 금액이 다르면 거절해야 한다"
  );
  // 다른 주문의 승인 결과를 흘려보내면 안 된다
  assert.equal(
    isMatchingCompletedPayment(payment({ orderId: "ORD-OTHER-000000" }), input),
    false
  );
  assert.equal(
    isMatchingCompletedPayment(payment({ paymentKey: "other_key" }), input),
    false
  );
  // 아직 승인이 끝나지 않은 결제
  assert.equal(
    isMatchingCompletedPayment(payment({ status: "IN_PROGRESS" }), input),
    false
  );
});

// --- 전액 취소 판정 ---

test("잔액 0이고 취소 합계가 주문 금액과 같아야 전액 취소로 본다", () => {
  const canceled = payment({
    status: "CANCELED",
    balanceAmount: 0,
    cancels: [cancellation()],
  });
  assert.equal(resolveFullCancellation(canceled, 300000)?.transactionKey, "txn-1");
});

test("부분 취소는 전액 취소로 처리하지 않는다", () => {
  const partial = payment({
    status: "CANCELED",
    balanceAmount: 100000,
    cancels: [cancellation({ cancelAmount: 200000 })],
  });
  assert.equal(resolveFullCancellation(partial, 300000), null);
});

test("취소 합계가 주문 금액과 다르면 전액 취소로 보지 않는다", () => {
  const mismatched = payment({
    status: "CANCELED",
    balanceAmount: 0,
    cancels: [cancellation({ cancelAmount: 250000 })],
  });
  assert.equal(resolveFullCancellation(mismatched, 300000), null);
});

test("완료되지 않은 취소 건은 합계에 넣지 않는다", () => {
  const pendingCancel = payment({
    status: "CANCELED",
    balanceAmount: 0,
    cancels: [
      cancellation({ cancelAmount: 300000, cancelStatus: "PENDING" }),
    ],
  });
  assert.equal(resolveFullCancellation(pendingCancel, 300000), null);
});

test("여러 번 나눠 취소해 합계가 맞으면 전액 취소로 본다", () => {
  const split = payment({
    status: "CANCELED",
    balanceAmount: 0,
    cancels: [
      cancellation({ cancelAmount: 100000, transactionKey: "txn-old", canceledAt: "2026-07-24T10:00:00Z" }),
      cancellation({ cancelAmount: 200000, transactionKey: "txn-new", canceledAt: "2026-07-26T10:00:00Z" }),
    ],
  });
  const resolved = resolveFullCancellation(split, 300000);
  assert.equal(resolved?.transactionKey, "txn-new", "가장 최근 취소 건을 돌려줘야 한다");
});

test("취소 상태가 아니면 전액 취소로 보지 않는다", () => {
  assert.equal(
    resolveFullCancellation(payment({ balanceAmount: 0, cancels: [cancellation()] }), 300000),
    null
  );
});

test("완료된 취소가 없으면 최신 취소 건도 없다", () => {
  assert.equal(
    resolveLatestCompletedCancellation(
      payment({ cancels: [cancellation({ cancelStatus: "ABORTED" })] })
    ),
    null
  );
});

// --- 취소 정산 가능 상태 ---

test("승인 후 발급이 끊긴 주문도 취소를 정산할 수 있어야 한다", () => {
  // 이 두 상태를 막으면 취소 사실이 유실되고 주문이 영구히 결제 대기로 남는다.
  assert.equal(canSettleCancellation("pending"), true);
  assert.equal(canSettleCancellation("failed"), true);
  assert.equal(canSettleCancellation("paid"), true);
  assert.equal(canSettleCancellation("refunded"), true);
});

test("이미 취소된 주문은 다시 정산하지 않는다", () => {
  assert.equal(canSettleCancellation("canceled"), false);
});

// --- 이용권 유효성 ---

test("만료가 없는 활성 이용권은 유효하다", () => {
  assert.equal(isActiveEntitlement({ status: "active", expires_at: null }), true);
});

test("만료 시각을 기준으로 이용권 유효성을 가른다", () => {
  const now = new Date("2026-07-30T00:00:00Z");
  assert.equal(
    isActiveEntitlement({ status: "active", expires_at: "2026-07-31T00:00:00Z" }, now),
    true
  );
  assert.equal(
    isActiveEntitlement({ status: "active", expires_at: "2026-07-29T00:00:00Z" }, now),
    false,
    "만료된 이용권은 유효하지 않다"
  );
});

test("회수된 이용권과 없는 이용권은 유효하지 않다", () => {
  assert.equal(isActiveEntitlement({ status: "revoked", expires_at: null }), false);
  assert.equal(isActiveEntitlement(null), false);
});

// --- 웹훅 이벤트 파싱 ---

test("정상적인 결제 상태 변경 이벤트를 읽어낸다", () => {
  const result = readPaymentEvent({
    eventType: "PAYMENT_STATUS_CHANGED",
    data: { paymentKey: PAYMENT_KEY, orderId: ORDER_UID, status: "DONE" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.event, {
    paymentKey: PAYMENT_KEY,
    orderId: ORDER_UID,
    status: "DONE",
  });
});

test("다루지 않는 이벤트 종류를 구분해서 알린다", () => {
  const result = readPaymentEvent({ eventType: "SOMETHING_ELSE", data: {} });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "unsupported_event");
});

test("본문이 망가진 웹훅은 invalid_payload로 처리한다", () => {
  const cases: unknown[] = [
    null,
    "text",
    { eventType: "PAYMENT_STATUS_CHANGED" },
    { eventType: "PAYMENT_STATUS_CHANGED", data: "not-an-object" },
    { eventType: "PAYMENT_STATUS_CHANGED", data: { paymentKey: "", orderId: ORDER_UID, status: "DONE" } },
    { eventType: "PAYMENT_STATUS_CHANGED", data: { paymentKey: PAYMENT_KEY, orderId: "bad id", status: "DONE" } },
    { eventType: "PAYMENT_STATUS_CHANGED", data: { paymentKey: PAYMENT_KEY, orderId: ORDER_UID, status: 200 } },
  ];

  for (const payload of cases) {
    const result = readPaymentEvent(payload);
    assert.equal(result.ok, false, `${JSON.stringify(payload)}는 거절돼야 한다`);
    assert.equal(!result.ok && result.reason, "invalid_payload");
  }
});

test("처리 대상 결제 상태만 지원한다", () => {
  assert.equal(isSupportedPaymentStatus("DONE"), true);
  assert.equal(isSupportedPaymentStatus("CANCELED"), true);
  assert.equal(isSupportedPaymentStatus("PARTIAL_CANCELED"), true);
  // 만료·중단은 별도 정리 대상이라 웹훅에서 상태를 바꾸지 않는다.
  assert.equal(isSupportedPaymentStatus("EXPIRED"), false);
  assert.equal(isSupportedPaymentStatus("ABORTED"), false);
});
