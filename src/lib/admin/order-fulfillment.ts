// 결제는 끝났는데 수강권이 없는 주문을 찾아낸다.
// 자동 알림이 없는 동안에는 이 판정이 유일한 발견 수단이므로 server-only 없이
// 순수 함수로 두고 테스트로 고정한다.

export type FulfillmentIssue =
  | "approved-not-fulfilled"
  | "paid-without-entitlement";

export type FulfillmentCheckInput = {
  source: "free_checkout" | "payment" | "admin_grant";
  paymentStatus: "pending" | "paid" | "canceled" | "refunded" | "failed";
  entitlementStatus: "active" | "revoked";
  paymentKeyPresent: boolean;
};

/**
 * 돈이 오간 흔적은 있는데 고객이 콘텐츠를 못 보는 상태를 가려낸다.
 *
 * approved-not-fulfilled
 *   Toss 승인 후 payment_key까지 기록됐는데 주문이 paid로 넘어가지 못했다.
 *   승인과 이용권 발급 사이에서 끊긴 경우로, 고객은 결제했는데 못 본다.
 *
 * paid-without-entitlement
 *   결제는 완료인데 이용권이 살아있지 않다. 발급 누락이거나 잘못된 회수다.
 *   환불된 주문은 refunded 상태가 되므로 여기 걸리지 않는다.
 */
export function detectFulfillmentIssue(
  order: FulfillmentCheckInput
): FulfillmentIssue | null {
  if (order.source !== "payment") return null;

  if (
    order.paymentKeyPresent &&
    (order.paymentStatus === "pending" || order.paymentStatus === "failed")
  ) {
    return "approved-not-fulfilled";
  }

  if (order.paymentStatus === "paid" && order.entitlementStatus !== "active") {
    return "paid-without-entitlement";
  }

  return null;
}

export function describeFulfillmentIssue(issue: FulfillmentIssue) {
  if (issue === "approved-not-fulfilled") {
    return "결제 승인 후 이용권 발급이 끝나지 않았습니다.";
  }
  return "결제는 완료됐지만 이용권이 활성 상태가 아닙니다.";
}
