import { after } from "next/server";
import { dispatchPaymentNotification } from "@/lib/messaging/payment-notifications";
import { isSameOriginRequest } from "@/lib/http/origin";
import { readLimitedJson } from "@/lib/http/request-body";
import {
  lookupVerifiedTossPaymentByKey,
  lookupVerifiedTossPaymentByOrderId,
  revalidatePaymentPaths,
  settleVerifiedTossPayment,
  shouldFinishRecoveryAsReview,
  type TossSettlementOrder,
} from "@/lib/payments/reconciliation";
import { confirmTossPayment, type TossPayment } from "@/lib/payments/toss";
import {
  parseConfirmRequest,
  resolveConfirmationFailure,
  type ConfirmRequest,
} from "@/lib/payments/toss-verification";
import { getPaymentMode, isTossPaymentConfigured } from "@/lib/store/free-enrollment";
import { getAdminClient } from "@/lib/supabase/admin";
import { getVerifiedIdentity } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const CONFIRM_BODY_LIMIT_BYTES = 4 * 1024;

type PreparedConfirmationRow = {
  order_uid: string;
  idempotency_key: string;
  lease_token: string | null;
  can_confirm: boolean;
};

export async function POST(request: Request) {
  const mode = getPaymentMode();
  if (mode !== "toss_test" && mode !== "toss_live") {
    return json({ ok: false, message: "결제 서버 설정을 확인하고 있습니다." }, 503);
  }
  if (!isTossPaymentConfigured()) {
    return json({ ok: false, message: "결제 서버 설정을 확인하고 있습니다." }, 503);
  }
  if (!isSameOriginRequest(request)) {
    return json({ ok: false, message: "결제 요청 출처를 확인하지 못했습니다." }, 403);
  }

  const input = await readConfirmRequest(request);
  if (!input) {
    return json({ ok: false, message: "결제 승인 정보를 다시 확인해 주세요." }, 400);
  }

  const supabase = await createClient();
  const identity = await getVerifiedIdentity(supabase);
  if (!identity) {
    return json({ ok: false, message: "로그인 후 결제를 확인해 주세요." }, 401);
  }

  const admin = getAdminClient();
  const { data: order, error } = await admin
    .from("orders")
    .select(
      "id, user_id, order_uid, product_id, amount, source, status, payment_key, payment_mode, refund_policy_version, refund_policy_agreed_at"
    )
    .eq("order_uid", input.orderId)
    .eq("user_id", identity.userId)
    .maybeSingle<TossSettlementOrder & { product_id: string }>();

  if (error) {
    console.error("Failed to load Toss payment order:", error.code);
    return json({ ok: false, message: "주문 정보를 확인하지 못했습니다." }, 500);
  }
  if (!order) {
    return json({ ok: false, message: "본인의 결제 주문을 찾지 못했습니다." }, 404);
  }
  if (order.amount !== input.amount) {
    console.error("Rejected Toss payment with an amount mismatch.");
    return json({ ok: false, message: "주문 금액이 일치하지 않습니다." }, 400);
  }
  if (order.source !== "payment") {
    return json({ ok: false, message: "결제 승인 대상 주문이 아닙니다." }, 409);
  }
  if (order.payment_mode !== null && order.payment_mode !== mode) {
    return json({ ok: false, message: "주문의 결제 실행 환경이 현재 서버 설정과 일치하지 않습니다." }, 409);
  }
  if (order.payment_key !== null && order.payment_key !== input.paymentKey) {
    return json({ ok: false, message: "주문에 등록된 결제 정보와 일치하지 않습니다." }, 409);
  }
  if (order.status !== "pending" && order.status !== "paid" && order.status !== "failed") {
    return json({ ok: false, message: "더 이상 승인할 수 없는 주문입니다." }, 409);
  }
  if (order.status === "pending" && (!order.refund_policy_version || !order.refund_policy_agreed_at)) {
    return json({ ok: false, message: "환불 정책 동의를 확인하지 못했습니다." }, 409);
  }
  if (order.payment_mode === null) {
    return settleLegacyFromProviderLookup(admin, order, input.paymentKey, mode);
  }

  const prepared = await prepareConfirmation(admin, identity.userId, input, mode);
  if (!prepared.ok) {
    return json({ ok: false, retryable: prepared.retryable, message: prepared.message }, prepared.status);
  }

  if (!prepared.row.can_confirm) {
    return settleFromProviderLookup(admin, order, mode, {
      retryableMessage: "결제 상태를 확인하고 있습니다. 잠시 후 다시 확인해 주세요.",
      httpStatus: 202,
    });
  }

  let payment: TossPayment | null = null;
  const confirmation = await confirmTossPayment({
    ...input,
    idempotencyKey: prepared.row.idempotency_key,
  });

  if (confirmation.ok) {
    payment = confirmation.payment;
  } else {
    const lookup = await lookupVerifiedTossPaymentByOrderId({ order, mode });
    if (lookup.ok) {
      payment = lookup.payment;
    } else {
      await finishRecovery(admin, input.orderId, prepared.row.lease_token, confirmation.code, lookup.kind === "mismatch");
      console.error("Toss confirmation did not reach a settled provider state:", confirmation.code);
      return json(
        {
          ok: false,
          retryable: confirmation.retryable || lookup.retryable,
          message: confirmation.retryable
            ? "결제 승인 확인이 지연되고 있습니다. 잠시 후 다시 확인해 주세요."
            : resolveConfirmationFailure(confirmation.code),
        },
        confirmation.retryable ? 503 : 409
      );
    }
  }

  const settlement = await settleVerifiedTossPayment({
    admin,
    order,
    payment,
    mode,
    requireCompletedEntitlement: true,
  });
  if (!settlement.ok) {
    await finishRecovery(
      admin,
      input.orderId,
      prepared.row.lease_token,
      settlement.errorCode ?? "SETTLEMENT_FAILED",
      shouldFinishRecoveryAsReview(settlement)
    );
    return json(
      {
        ok: false,
        retryable: settlement.retryable,
        message: settlement.message,
      },
      settlement.retryable ? 202 : 409
    );
  }

  if (settlement.kind !== "paid") {
    await finishRecovery(admin, input.orderId, prepared.row.lease_token, `TOSS_${settlement.kind.toUpperCase()}`, false);
    return json(
      {
        ok: false,
        retryable: false,
        message:
          settlement.kind === "canceled"
            ? "결제가 취소된 상태입니다. 주문 페이지에서 다시 확인해 주세요."
            : "결제가 완료되지 않았습니다. 주문 페이지에서 다시 시도해 주세요.",
      },
      409
    );
  }

  revalidatePaymentPaths(settlement.productSlug);
  after(async () => {
    await dispatchPaymentNotification(input.orderId);
  });

  return json(
    {
      ok: true,
      alreadyProcessed: settlement.alreadyProcessed,
      productSlug: settlement.productSlug,
      productType: settlement.productType,
      expiresAt: settlement.expiresAt,
    },
    200
  );
}

async function settleLegacyFromProviderLookup(
  admin: ReturnType<typeof getAdminClient>,
  order: TossSettlementOrder,
  paymentKey: string,
  mode: "toss_test" | "toss_live"
) {
  const lookup = await lookupVerifiedTossPaymentByKey({ paymentKey, order, mode });
  if (!lookup.ok) {
    return json(
      {
        ok: false,
        retryable: lookup.retryable,
        message:
          lookup.kind === "not_found"
            ? "이전 주문은 결제사 완료 내역이 확인될 때만 복구할 수 있습니다. 주문 페이지에서 새 결제를 시작해 주세요."
            : lookup.message,
      },
      lookup.retryable ? 202 : 409
    );
  }

  const settlement = await settleVerifiedTossPayment({
    admin,
    order,
    payment: lookup.payment,
    mode,
    requireCompletedEntitlement: lookup.payment.status === "DONE",
  });
  if (!settlement.ok) {
    return json(
      { ok: false, retryable: settlement.retryable, message: settlement.message },
      settlement.retryable ? 202 : 409
    );
  }
  if (settlement.kind !== "paid") {
    return json(
      {
        ok: false,
        retryable: false,
        message: "이전 주문의 결제 완료 내역이 확인되지 않았습니다. 주문 페이지에서 다시 확인해 주세요.",
      },
      409
    );
  }

  after(async () => {
    await dispatchPaymentNotification(order.order_uid);
  });
  return json(
    {
      ok: true,
      alreadyProcessed: settlement.alreadyProcessed,
      productSlug: settlement.productSlug,
      productType: settlement.productType,
      expiresAt: settlement.expiresAt,
    },
    200
  );
}

async function settleFromProviderLookup(
  admin: ReturnType<typeof getAdminClient>,
  order: TossSettlementOrder,
  mode: "toss_test" | "toss_live",
  pending: { retryableMessage: string; httpStatus: number }
) {
  const lookup = await lookupVerifiedTossPaymentByOrderId({ order, mode });
  if (!lookup.ok) {
    return json(
      {
        ok: false,
        retryable: lookup.retryable,
        message: lookup.retryable ? pending.retryableMessage : lookup.message,
      },
      lookup.retryable ? pending.httpStatus : 409
    );
  }

  const settlement = await settleVerifiedTossPayment({
    admin,
    order,
    payment: lookup.payment,
    mode,
    requireCompletedEntitlement: true,
  });
  if (!settlement.ok) {
    return json(
      { ok: false, retryable: settlement.retryable, message: settlement.message },
      settlement.retryable ? pending.httpStatus : 409
    );
  }
  if (settlement.kind !== "paid") {
    return json(
      {
        ok: false,
        retryable: false,
        message:
          settlement.kind === "canceled"
            ? "결제가 취소된 상태입니다. 주문 페이지에서 다시 확인해 주세요."
            : "결제가 완료되지 않았습니다. 주문 페이지에서 다시 시도해 주세요.",
      },
      409
    );
  }

  after(async () => {
    await dispatchPaymentNotification(order.order_uid);
  });
  return json(
    {
      ok: true,
      alreadyProcessed: settlement.alreadyProcessed,
      productSlug: settlement.productSlug,
      productType: settlement.productType,
      expiresAt: settlement.expiresAt,
    },
    200
  );
}

async function prepareConfirmation(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
  input: ConfirmRequest,
  mode: "toss_test" | "toss_live"
): Promise<
  | { ok: true; row: PreparedConfirmationRow }
  | { ok: false; status: number; retryable: boolean; message: string }
> {
  const { data, error } = await admin.rpc("prepare_toss_confirmation_server", {
    target_user_id: userId,
    target_order_uid: input.orderId,
    target_payment_key: input.paymentKey,
    target_amount: input.amount,
    target_mode: mode,
  });
  if (error) {
    console.error("Failed to prepare Toss confirmation:", error.code);
    return {
      ok: false,
      status: 500,
      retryable: true,
      message: "결제 승인 준비를 완료하지 못했습니다. 다시 확인해 주세요.",
    };
  }

  const row = (Array.isArray(data) ? data[0] : null) as PreparedConfirmationRow | null;
  if (
    !row ||
    row.order_uid !== input.orderId ||
    !row.idempotency_key ||
    (row.can_confirm && !row.lease_token)
  ) {
    console.error("Toss confirmation prepare returned an invalid response.");
    return {
      ok: false,
      status: 500,
      retryable: true,
      message: "결제 승인 준비 상태를 확인하지 못했습니다.",
    };
  }

  return { ok: true, row };
}

async function finishRecovery(
  admin: ReturnType<typeof getAdminClient>,
  orderUid: string,
  leaseToken: string | null,
  errorCode: string,
  review: boolean
) {
  if (!leaseToken) return;

  const { error } = await admin.rpc("finish_toss_payment_recovery", {
    target_order_uid: orderUid,
    target_lease_token: leaseToken,
    target_error_code: errorCode,
    target_review: review,
  });
  if (error) {
    console.error("Failed to finish Toss payment recovery lease:", error.code);
  }
}

async function readConfirmRequest(request: Request): Promise<ConfirmRequest | null> {
  const result = await readLimitedJson(request, {
    limitBytes: CONFIRM_BODY_LIMIT_BYTES,
  });
  if (!result.ok) return null;

  return parseConfirmRequest(result.value);
}

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
