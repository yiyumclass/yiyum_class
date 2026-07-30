// 결제 승인·취소를 받아들일지 판단하는 순수 로직.
//
// 라우트 핸들러 안에 두면 DB와 외부 API에 묶여 테스트할 수 없고, 같은 판정이
// 여러 파일에 복제된다(실제로 resolveFullCancellation이 웹훅과 관리자 환불에
// 중복돼 있었다). 돈이 오가는 판단이므로 한곳에 모아 테스트로 고정한다.
//
// server-only를 붙이지 않는다. 외부 호출이 없는 순수 함수라 테스트에서
// 그대로 불러 쓸 수 있어야 한다.

export type TossCancellation = {
  cancelAmount: number;
  cancelReason: string;
  canceledAt: string;
  transactionKey: string;
  cancelStatus: string;
};

export type TossPayment = {
  paymentKey: string;
  orderId: string;
  status: string;
  totalAmount: number;
  balanceAmount: number;
  approvedAt: string | null;
  method: string | null;
  cancels: TossCancellation[];
};

export type ConfirmRequest = {
  paymentKey: string;
  orderId: string;
  amount: number;
};

export type OrderPaymentStatus =
  | "pending"
  | "paid"
  | "canceled"
  | "refunded"
  | "failed";

export type PaymentEventResult =
  | { ok: true; event: { paymentKey: string; orderId: string; status: string } }
  | { ok: false; reason: "unsupported_event" | "invalid_payload" };

const ORDER_UID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_PAYMENT_KEY_LENGTH = 200;

/**
 * 취소를 정산할 수 있는 주문 상태.
 *
 * pending/failed를 포함하는 이유: 승인 직후 이용권 발급이 끊기면 주문은
 * paid로 넘어가지 못한 채 남는다. payment_key 일치 검증이 승인 사실을
 * 보장하므로, 이 상태에서 취소가 와도 정산해야 주문이 영구히 결제 대기로
 * 남지 않는다.
 */
export const SETTLEABLE_CANCEL_STATUSES: readonly OrderPaymentStatus[] = [
  "paid",
  "refunded",
  "pending",
  "failed",
];

export function canSettleCancellation(status: OrderPaymentStatus) {
  return SETTLEABLE_CANCEL_STATUSES.includes(status);
}

/**
 * 클라이언트가 보낸 승인 요청 본문을 검증한다.
 * 금액은 DB 주문과 다시 대조하므로 여기서는 형식만 본다.
 */
export function parseConfirmRequest(value: unknown): ConfirmRequest | null {
  if (!isRecord(value)) return null;

  const { paymentKey, orderId, amount } = value;
  if (
    typeof paymentKey !== "string" ||
    paymentKey.length < 1 ||
    paymentKey.length > MAX_PAYMENT_KEY_LENGTH ||
    typeof orderId !== "string" ||
    !ORDER_UID_PATTERN.test(orderId) ||
    !Number.isInteger(amount) ||
    (amount as number) <= 0
  ) {
    return null;
  }

  return { paymentKey, orderId, amount: amount as number };
}

/**
 * Toss가 돌려준 승인 결과가 우리가 요청한 그 결제가 맞는지 확인한다.
 * 네 값을 모두 대조해야 다른 주문의 승인 결과를 흘려보내지 않는다.
 */
export function isMatchingCompletedPayment(
  payment: TossPayment,
  input: ConfirmRequest
) {
  return (
    payment.status === "DONE" &&
    payment.paymentKey === input.paymentKey &&
    payment.orderId === input.orderId &&
    payment.totalAmount === input.amount
  );
}

/**
 * 전액 취소가 완료된 경우에만 취소 건을 돌려준다.
 * 부분취소는 앱이 자동 처리하지 않으므로 여기서 걸러야 한다.
 */
export function resolveFullCancellation(
  payment: TossPayment,
  expectedAmount: number
): TossCancellation | null {
  if (payment.status !== "CANCELED" || payment.balanceAmount !== 0) return null;

  const completed = payment.cancels.filter((item) => item.cancelStatus === "DONE");
  const canceledAmount = completed.reduce(
    (total, item) => total + item.cancelAmount,
    0
  );
  if (canceledAmount !== expectedAmount) return null;

  return resolveLatestCompletedCancellation(payment);
}

export function resolveLatestCompletedCancellation(
  payment: TossPayment
): TossCancellation | null {
  const completed = payment.cancels
    .filter((item) => item.cancelStatus === "DONE")
    .sort(
      (a, b) => new Date(b.canceledAt).getTime() - new Date(a.canceledAt).getTime()
    );

  return completed[0] ?? null;
}

export function isActiveEntitlement(
  entitlement: { status: string; expires_at: string | null } | null,
  now: Date = new Date()
) {
  if (!entitlement || entitlement.status !== "active") return false;
  return entitlement.expires_at === null || new Date(entitlement.expires_at) > now;
}

export function readPaymentEvent(payload: unknown): PaymentEventResult {
  if (!isRecord(payload)) return { ok: false, reason: "invalid_payload" };
  if (payload.eventType !== "PAYMENT_STATUS_CHANGED") {
    return { ok: false, reason: "unsupported_event" };
  }

  const data = payload.data;
  if (!isRecord(data)) return { ok: false, reason: "invalid_payload" };
  if (
    typeof data.paymentKey !== "string" ||
    data.paymentKey.length < 1 ||
    data.paymentKey.length > MAX_PAYMENT_KEY_LENGTH ||
    typeof data.orderId !== "string" ||
    !ORDER_UID_PATTERN.test(data.orderId) ||
    typeof data.status !== "string"
  ) {
    return { ok: false, reason: "invalid_payload" };
  }

  return {
    ok: true,
    event: {
      paymentKey: data.paymentKey,
      orderId: data.orderId,
      status: data.status,
    },
  };
}

export function isSupportedPaymentStatus(status: string) {
  return status === "DONE" || status === "CANCELED" || status === "PARTIAL_CANCELED";
}

export function resolveConfirmationFailure(code: string) {
  if (code === "REJECT_CARD_PAYMENT") {
    return "카드 결제가 승인되지 않았습니다. 다른 카드나 결제수단을 이용해 주세요.";
  }
  if (code === "NOT_FOUND_PAYMENT_SESSION") {
    return "결제 인증 시간이 만료되었습니다. 주문 페이지에서 다시 결제해 주세요.";
  }
  if (code === "FORBIDDEN_REQUEST") {
    return "결제 요청 정보를 확인하지 못했습니다. 다시 결제해 주세요.";
  }
  return "결제 승인을 완료하지 못했습니다. 주문 페이지에서 다시 시도해 주세요.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
