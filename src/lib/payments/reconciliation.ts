import "server-only";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTossPayment, getTossPaymentByOrderId, type TossPayment } from "./toss";
import {
  isMatchingCompletedPayment,
  resolveFullCancellation,
  resolveLatestCompletedCancellation,
  type ConfirmRequest,
  type OrderPaymentStatus,
} from "./toss-verification";
import type { ProductType } from "@/lib/store/product-type";
import type { PaymentMode } from "@/lib/store/payment-mode";

export type TossSettlementOrder = {
  id: string;
  user_id: string;
  order_uid: string;
  amount: number;
  source: "free_checkout" | "payment" | "admin_grant";
  status: OrderPaymentStatus;
  payment_key: string | null;
  payment_mode: "toss_test" | "toss_live" | null;
  refund_policy_version?: string | null;
  refund_policy_agreed_at?: string | null;
};

export type TossSettlementResult =
  | {
      ok: true;
      kind: "paid";
      alreadyProcessed: boolean;
      productSlug: string | null;
      productType: string | null;
      expiresAt: string | null;
    }
  | { ok: true; kind: "canceled" | "unpaid_closed" | "partial_cancellation_recorded" }
  | {
      ok: false;
      kind: "pending" | "mismatch" | "review" | "unknown";
      retryable: boolean;
      message: string;
      errorCode?: string;
    };

export type VerifiedTossLookupResult =
  | { ok: true; payment: TossPayment }
  | {
      ok: false;
      kind: "not_found" | "mismatch" | "unknown";
      retryable: boolean;
      message: string;
      errorCode?: string;
    };

type CompletedPaymentRow = {
  product_slug: string;
  product_type: ProductType;
  expires_at: string | null;
};

type RefundSettlementRow = {
  refund_status: "succeeded" | "review";
};

type SupabaseAdmin = SupabaseClient;

const PERMANENT_SETTLEMENT_ERROR_CODES = new Set(["55000", "22023", "23505"]);
const PRODUCT_TYPES = new Set<ProductType>(["course", "ebook", "consulting"]);

export function isTossRuntimeMode(mode: PaymentMode): mode is "toss_test" | "toss_live" {
  return mode === "toss_test" || mode === "toss_live";
}

export function shouldReviewSettlementError(code: string | undefined) {
  return Boolean(code && PERMANENT_SETTLEMENT_ERROR_CODES.has(code));
}

export function shouldFinishRecoveryAsReview(result: TossSettlementResult) {
  return !result.ok && result.kind === "review";
}

export function isStoredModeCompatible(
  storedMode: "toss_test" | "toss_live" | null,
  runtimeMode: "toss_test" | "toss_live"
) {
  return storedMode === null || storedMode === runtimeMode;
}

export async function lookupVerifiedTossPaymentByOrderId(input: {
  order: Pick<TossSettlementOrder, "order_uid" | "amount" | "payment_key" | "payment_mode">;
  mode: "toss_test" | "toss_live";
}): Promise<VerifiedTossLookupResult> {
  if (!isStoredModeCompatible(input.order.payment_mode, input.mode)) {
    return modeMismatchResult();
  }

  const lookup = await getTossPaymentByOrderId(input.order.order_uid);
  if (!lookup.ok) {
    return lookupErrorResult(lookup.code, lookup.retryable);
  }

  return verifyTossPaymentForOrder({
    payment: lookup.payment,
    order: input.order,
    mode: input.mode,
  });
}

export async function lookupVerifiedTossPaymentByKey(input: {
  paymentKey: string;
  order: Pick<TossSettlementOrder, "order_uid" | "amount" | "payment_key" | "payment_mode">;
  mode: "toss_test" | "toss_live";
}): Promise<VerifiedTossLookupResult> {
  if (!isStoredModeCompatible(input.order.payment_mode, input.mode)) {
    return modeMismatchResult();
  }

  const lookup = await getTossPayment(input.paymentKey);
  if (!lookup.ok) {
    return lookupErrorResult(lookup.code, lookup.retryable);
  }

  return verifyTossPaymentForOrder({
    payment: lookup.payment,
    order: input.order,
    mode: input.mode,
  });
}

export function verifyTossPaymentForOrder(input: {
  payment: TossPayment;
  order: Pick<TossSettlementOrder, "order_uid" | "amount" | "payment_key" | "payment_mode">;
  mode: "toss_test" | "toss_live";
}): VerifiedTossLookupResult {
  if (!isStoredModeCompatible(input.order.payment_mode, input.mode)) {
    return modeMismatchResult();
  }
  if (
    input.payment.orderId !== input.order.order_uid ||
    input.payment.totalAmount !== input.order.amount ||
    (input.order.payment_key !== null && input.payment.paymentKey !== input.order.payment_key)
  ) {
    return {
      ok: false,
      kind: "mismatch",
      retryable: false,
      message: "Toss 결제 정보가 주문과 일치하지 않습니다.",
      errorCode: "TOSS_PAYMENT_MISMATCH",
    };
  }

  return { ok: true, payment: input.payment };
}

export async function settleVerifiedTossPayment(input: {
  admin: SupabaseAdmin;
  order: TossSettlementOrder;
  payment: TossPayment;
  mode: "toss_test" | "toss_live";
  actorUserId?: string | null;
  refundUid?: string | null;
  refundReason?: string | null;
  requireCompletedEntitlement?: boolean;
}): Promise<TossSettlementResult> {
  const verified = verifyTossPaymentForOrder({
    payment: input.payment,
    order: input.order,
    mode: input.mode,
  });
  if (!verified.ok) {
    return {
      ok: false,
      kind: verified.kind === "mismatch" ? "mismatch" : "unknown",
      retryable: verified.retryable,
      message: verified.message,
      errorCode: verified.errorCode,
    };
  }

  if (input.order.payment_mode === null) {
    const bound = await bindVerifiedLegacyOrderMode({
      admin: input.admin,
      order: input.order,
      payment: input.payment,
      mode: input.mode,
    });
    if (!bound) {
      return {
        ok: false,
        kind: "review",
        retryable: true,
        message: "결제 실행 환경을 주문에 연결하지 못했습니다.",
        errorCode: "PAYMENT_MODE_BIND_FAILED",
      };
    }
  }

  if (
    input.payment.status === "DONE" ||
    input.payment.status === "CANCELED" ||
    input.payment.status === "PARTIAL_CANCELED"
  ) {
    const ensured = await ensureTossReconciliation(input.admin, input.order, input.payment, input.mode);
    if (!ensured.ok) return ensured;
  }

  if (input.payment.status === "DONE") {
    return settleCompletedPayment(input.admin, input.order, input.payment, {
      requireCompletedEntitlement: input.requireCompletedEntitlement === true,
    });
  }

  if (input.payment.status === "CANCELED") {
    return settleCanceledPayment(input);
  }

  if (input.payment.status === "PARTIAL_CANCELED") {
    return recordPartialCancellation(input.admin, input.order, input.payment);
  }

  if (input.payment.status === "ABORTED" || input.payment.status === "EXPIRED") {
    return settleProviderClosedUnpaidOrder(input.admin, input.order, input.payment, input.mode);
  }

  return {
    ok: false,
    kind: "pending",
    retryable: true,
    message: "결제사가 아직 최종 상태를 확정하지 않았습니다.",
    errorCode: `TOSS_STATUS_${input.payment.status}`,
  };
}

export function revalidatePaymentPaths(productSlug?: string | null) {
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/members");
  revalidatePath("/my");
  revalidatePath("/learn", "layout");
  if (productSlug) {
    revalidatePath(`/learn/${productSlug}`);
  }
}

function isCompletedPayment(
  payment: TossPayment,
  order: Pick<TossSettlementOrder, "order_uid" | "amount" | "payment_key">
) {
  const input: ConfirmRequest = {
    paymentKey: payment.paymentKey,
    orderId: order.order_uid,
    amount: order.amount,
  };
  return isMatchingCompletedPayment(payment, input);
}

async function settleCompletedPayment(
  admin: SupabaseAdmin,
  order: TossSettlementOrder,
  payment: TossPayment,
  options: { requireCompletedEntitlement: boolean }
): Promise<TossSettlementResult> {
  if (!isCompletedPayment(payment, order)) {
    return {
      ok: false,
      kind: "mismatch",
      retryable: false,
      message: "완료된 결제 정보가 주문과 일치하지 않습니다.",
      errorCode: "DONE_PAYMENT_MISMATCH",
    };
  }

  const alreadyProcessed = order.status === "paid" && order.payment_key === payment.paymentKey;
  if (!alreadyProcessed) {
    if (order.status !== "pending" && order.status !== "failed") {
      return {
        ok: false,
        kind: "mismatch",
        retryable: false,
        message: "현재 주문 상태에서는 결제 완료를 반영할 수 없습니다.",
        errorCode: "ORDER_STATUS_NOT_SETTLEABLE",
      };
    }
    if (!order.refund_policy_version || !order.refund_policy_agreed_at) {
      return {
        ok: false,
        kind: "mismatch",
        retryable: false,
        message: "환불 정책 동의를 확인하지 못했습니다.",
        errorCode: "REFUND_POLICY_CONSENT_MISSING",
      };
    }

  }

  const { data, error } = await admin.rpc("complete_toss_payment_server", {
    target_user_id: order.user_id,
    target_order_uid: order.order_uid,
    target_payment_key: payment.paymentKey,
    target_amount: order.amount,
    target_approved_at: payment.approvedAt,
  });
  const completed = readCompletedPaymentRow(data);
  if (error || !completed) {
    console.error("Failed to settle approved Toss payment:", error?.code ?? "EMPTY_COMPLETION");
    return settlementPersistenceFailure(error?.code ?? "EMPTY_COMPLETION", {
      emptyResult: !error && !completed,
      message: options.requireCompletedEntitlement
        ? "결제는 완료됐지만 이용권 발급을 확인 중입니다."
        : "결제 완료 상태를 내부 주문에 반영하지 못했습니다.",
    });
  }

  revalidatePaymentPaths(completed?.product_slug);
  return {
    ok: true,
    kind: "paid",
    alreadyProcessed,
    productSlug: completed?.product_slug ?? null,
    productType: completed?.product_type ?? null,
    expiresAt: completed?.expires_at ?? null,
  };
}

async function settleCanceledPayment(input: {
  admin: SupabaseAdmin;
  order: TossSettlementOrder;
  payment: TossPayment;
  actorUserId?: string | null;
  refundUid?: string | null;
  refundReason?: string | null;
}): Promise<TossSettlementResult> {
  const cancellation = resolveFullCancellation(input.payment, input.order.amount);
  if (!cancellation) {
    return recordPartialCancellation(input.admin, input.order, input.payment);
  }

  const { data, error } = await input.admin.rpc("complete_toss_refund_server", {
    target_order_uid: input.order.order_uid,
    target_payment_key: input.payment.paymentKey,
    target_amount: input.order.amount,
    target_canceled_at: cancellation.canceledAt,
    target_transaction_key: cancellation.transactionKey,
    target_refund_uid: input.refundUid ?? null,
    target_actor_user_id: input.actorUserId ?? null,
    target_reason: input.refundReason ?? cancellation.cancelReason,
  });
  const refund = readRefundSettlementRow(data);
  if (error || !refund) {
    console.error("Failed to reconcile canceled Toss payment:", error?.code ?? "EMPTY_REFUND");
    return settlementPersistenceFailure(error?.code ?? "EMPTY_REFUND", {
      emptyResult: !error && !refund,
      message: "Toss 취소는 확인됐지만 내부 반영을 재확인하고 있습니다.",
    });
  }
  if (refund.refund_status === "review") {
    return {
      ok: false,
      kind: "review",
      retryable: false,
      message: "Toss 환불은 완료됐지만 이전 수강권 연결은 관리자 검토가 필요합니다.",
      errorCode: "LEGACY_ENTITLEMENT_LINK_REQUIRES_REVIEW",
    };
  }

  revalidatePaymentPaths();
  return { ok: true, kind: "canceled" };
}

async function recordPartialCancellation(
  admin: SupabaseAdmin,
  order: TossSettlementOrder,
  payment: TossPayment
): Promise<TossSettlementResult> {
  const cancellation = resolveLatestCompletedCancellation(payment);
  if (!cancellation || cancellation.cancelAmount >= order.amount) {
    return {
      ok: false,
      kind: "review",
      retryable: false,
      message: "부분 취소 내역을 확인하지 못했습니다.",
      errorCode: "PARTIAL_CANCELLATION_UNVERIFIED",
    };
  }

  const refundUid = `partial-${payment.paymentKey}-${cancellation.transactionKey}`.slice(0, 200);
  const { error } = await admin.from("payment_refunds").upsert(
    {
      order_id: order.id,
      refund_uid: refundUid,
      amount: cancellation.cancelAmount,
      reason: "Unsupported manual partial Toss cancellation",
      status: "failed",
      requested_by: null,
      idempotency_key: `reconcile-${refundUid}`.slice(0, 200),
      toss_transaction_key: cancellation.transactionKey,
      toss_cancel_status: cancellation.cancelStatus,
      error_code: "PARTIAL_CANCELLATION_UNSUPPORTED",
      error_message: "Toss 콘솔에서 부분취소가 발생했지만 앱은 전액 환불만 자동 처리합니다.",
      completed_at: cancellation.canceledAt,
    },
    { onConflict: "refund_uid" }
  );
  if (error) {
    console.error("Failed to record partial Toss cancellation:", error.code);
    return {
      ok: false,
      kind: "review",
      retryable: true,
      message: "부분 취소 내역 기록을 재확인하고 있습니다.",
      errorCode: error.code,
    };
  }

  revalidatePaymentPaths();
  return { ok: true, kind: "partial_cancellation_recorded" };
}

async function settleProviderClosedUnpaidOrder(
  admin: SupabaseAdmin,
  order: TossSettlementOrder,
  payment: TossPayment,
  mode: "toss_test" | "toss_live"
): Promise<TossSettlementResult> {
  const { data, error } = await admin.rpc("settle_toss_unpaid_order_server", {
    target_order_uid: order.order_uid,
    target_payment_key: payment.paymentKey,
    target_status: payment.status,
    target_mode: mode,
  });
  if (error || data !== true) {
    console.error("Failed to settle provider-closed Toss payment:", error?.code ?? "FALSE");
    return {
      ok: false,
      kind: "review",
      retryable: true,
      message: "종료된 결제 상태를 내부 주문에 반영하지 못했습니다.",
      errorCode: error?.code ?? "UNPAID_SETTLEMENT_FALSE",
    };
  }

  revalidatePaymentPaths();
  return { ok: true, kind: "unpaid_closed" };
}

async function ensureTossReconciliation(
  admin: SupabaseAdmin,
  order: TossSettlementOrder,
  payment: TossPayment,
  mode: "toss_test" | "toss_live"
): Promise<{ ok: true } | Extract<TossSettlementResult, { ok: false }>> {
  const { data, error } = await admin.rpc("ensure_toss_reconciliation_server", {
    target_user_id: order.user_id,
    target_order_uid: order.order_uid,
    target_payment_key: payment.paymentKey,
    target_amount: order.amount,
    target_mode: mode,
    target_provider_status: payment.status,
    target_approved_at: payment.approvedAt,
  });
  if (error || data !== true) {
    console.error("Failed to ensure Toss reconciliation evidence:", error?.code ?? "FALSE");
    return settlementPersistenceFailure(error?.code ?? "ENSURE_RECONCILIATION_FALSE", {
      emptyResult: !error && data !== true,
      message: "Toss 결제 증거를 내부 주문에 반영하지 못했습니다.",
    });
  }

  return { ok: true };
}

function settlementPersistenceFailure(
  code: string,
  input: { emptyResult: boolean; message: string }
): Extract<TossSettlementResult, { ok: false }> {
  if (input.emptyResult || shouldReviewSettlementError(code)) {
    return {
      ok: false,
      kind: "review",
      retryable: false,
      message: input.message,
      errorCode: code,
    };
  }

  return {
    ok: false,
    kind: "unknown",
    retryable: true,
    message: input.message,
    errorCode: code,
  };
}

export async function bindVerifiedLegacyOrderMode(input: {
  admin: SupabaseAdmin;
  order: TossSettlementOrder;
  payment: TossPayment;
  mode: "toss_test" | "toss_live";
}) {
  const verified = verifyTossPaymentForOrder({
    payment: input.payment,
    order: input.order,
    mode: input.mode,
  });
  if (!verified.ok) return false;
  if (input.order.payment_mode !== null) return input.order.payment_mode === input.mode;

  const { data, error } = await input.admin.rpc("bind_toss_order_mode_server", {
    target_user_id: input.order.user_id,
    target_order_uid: input.order.order_uid,
    target_mode: input.mode,
  });
  if (error) {
    console.error("Failed to bind legacy Toss order mode:", error.code);
    return false;
  }
  return data === true;
}

function lookupErrorResult(code: string, retryable: boolean): VerifiedTossLookupResult {
  return {
    ok: false,
    kind: code === "NOT_FOUND_PAYMENT" ? "not_found" : "unknown",
    retryable,
    message: retryable
      ? "Toss 결제 상태 확인이 지연되고 있습니다."
      : "Toss 결제 상태를 확인하지 못했습니다.",
    errorCode: code,
  };
}

function modeMismatchResult(): VerifiedTossLookupResult {
  return {
    ok: false,
    kind: "mismatch",
    retryable: false,
    message: "주문의 결제 실행 환경이 현재 서버 설정과 일치하지 않습니다.",
    errorCode: "PAYMENT_MODE_MISMATCH",
  };
}

function readCompletedPaymentRow(completed: unknown): CompletedPaymentRow | null {
  const row = Array.isArray(completed) ? completed[0] : null;
  if (!isRecord(row)) return null;
  if (
    typeof row.product_slug !== "string" ||
    row.product_slug.trim().length === 0 ||
    typeof row.product_type !== "string" ||
    !PRODUCT_TYPES.has(row.product_type as ProductType) ||
    !(typeof row.expires_at === "string" || row.expires_at === null)
  ) {
    return null;
  }

  return {
    product_slug: row.product_slug,
    product_type: row.product_type as ProductType,
    expires_at: row.expires_at,
  };
}

function readRefundSettlementRow(refund: unknown): RefundSettlementRow | null {
  const row = Array.isArray(refund) ? refund[0] : null;
  if (!isRecord(row)) return null;
  if (row.refund_status !== "succeeded" && row.refund_status !== "review") {
    return null;
  }
  return { refund_status: row.refund_status };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
