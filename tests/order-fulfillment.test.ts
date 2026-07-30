import assert from "node:assert/strict";
import test from "node:test";
import {
  detectFulfillmentIssue,
  type FulfillmentCheckInput,
} from "../src/lib/admin/order-fulfillment.ts";

const paidOrder: FulfillmentCheckInput = {
  source: "payment",
  paymentStatus: "paid",
  entitlementStatus: "active",
  paymentKeyPresent: true,
};

test("정상적으로 이행된 결제는 확인 대상이 아니다", () => {
  assert.equal(detectFulfillmentIssue(paidOrder), null);
});

test("승인됐는데 이용권 발급이 끝나지 않은 주문을 찾아낸다", () => {
  // 승인 직후 RPC가 실패하면 payment_key는 남고 상태는 pending에 머문다.
  assert.equal(
    detectFulfillmentIssue({
      ...paidOrder,
      paymentStatus: "pending",
      entitlementStatus: "revoked",
    }),
    "approved-not-fulfilled"
  );

  assert.equal(
    detectFulfillmentIssue({
      ...paidOrder,
      paymentStatus: "failed",
      entitlementStatus: "revoked",
    }),
    "approved-not-fulfilled"
  );
});

test("결제 시작 전 이탈한 주문은 확인 대상이 아니다", () => {
  // 결제창만 열고 이탈하면 payment_key가 없다. 돈이 오가지 않았다.
  assert.equal(
    detectFulfillmentIssue({
      ...paidOrder,
      paymentStatus: "pending",
      entitlementStatus: "revoked",
      paymentKeyPresent: false,
    }),
    null
  );
});

test("결제 완료인데 이용권이 없으면 찾아낸다", () => {
  assert.equal(
    detectFulfillmentIssue({ ...paidOrder, entitlementStatus: "revoked" }),
    "paid-without-entitlement"
  );
});

test("환불·취소된 주문은 확인 대상이 아니다", () => {
  for (const paymentStatus of ["refunded", "canceled"] as const) {
    assert.equal(
      detectFulfillmentIssue({
        ...paidOrder,
        paymentStatus,
        entitlementStatus: "revoked",
      }),
      null,
      `${paymentStatus} 주문은 정상 종료다`
    );
  }
});

test("무료 신청과 관리자 지급은 결제 이행 판정 대상이 아니다", () => {
  for (const source of ["free_checkout", "admin_grant"] as const) {
    assert.equal(
      detectFulfillmentIssue({
        ...paidOrder,
        source,
        entitlementStatus: "revoked",
      }),
      null,
      `${source}는 결제 경로가 아니다`
    );
  }
});
