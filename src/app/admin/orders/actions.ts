"use server";

import { requireAdmin, requireOwnerAdmin } from "@/lib/admin/auth";
import {
  readOption,
  readParam,
  resolvePeriodStart,
} from "@/lib/admin/list-params";
import {
  ADMIN_ORDER_PERIODS,
  ADMIN_ORDER_PRODUCT_TYPE_FILTERS,
  ADMIN_ORDER_SORTS,
  ADMIN_ORDER_SOURCE_FILTERS,
  ADMIN_ORDER_STATUS_FILTERS,
  loadAdminOrdersForExport,
  type AdminOrder,
} from "@/lib/admin/orders";
import {
  bindVerifiedLegacyOrderMode,
  lookupVerifiedTossPaymentByKey,
  lookupVerifiedTossPaymentByOrderId,
  revalidatePaymentPaths,
  settleVerifiedTossPayment,
  type TossSettlementOrder,
} from "@/lib/payments/reconciliation";
import {
  cancelTossPayment,
  type TossPayment,
} from "@/lib/payments/toss";
import { getPaymentMode, isTossPaymentConfigured } from "@/lib/store/free-enrollment";
import { getAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation/safe-input";

export type RefundPaymentOrderResult = {
  ok: boolean;
  message: string;
};

/** 화면이 URL에 걸어 둔 조회 조건. 클라이언트가 보낸 값이라 그대로 믿지 않는다. */
export type ExportAdminOrdersInput = {
  q?: string;
  type?: string;
  source?: string;
  status?: string;
  period?: string;
  attention?: boolean;
  sort?: string;
};

/**
 * CSV 내보내기.
 *
 * 목록이 서버 페이지네이션으로 바뀌면서 브라우저에는 한 페이지밖에 없다. 정산과
 * CS 대응은 걸린 필터 전체가 필요하므로, 같은 조건으로 서버에서 다시 읽어 돌려준다.
 */
export async function exportAdminOrdersAction(
  input: ExportAdminOrdersInput
): Promise<{ rows: AdminOrder[]; truncated: boolean }> {
  await requireAdmin();

  const period = readOption(input.period, ADMIN_ORDER_PERIODS, "all");
  const { orders, truncated } = await loadAdminOrdersForExport({
    search: readParam(input.q),
    productType: readOption(input.type, ADMIN_ORDER_PRODUCT_TYPE_FILTERS, "all"),
    source: readOption(input.source, ADMIN_ORDER_SOURCE_FILTERS, "all"),
    status: readOption(input.status, ADMIN_ORDER_STATUS_FILTERS, "all"),
    since: resolvePeriodStart(period),
    attention: input.attention === true,
    sort: readOption(input.sort, ADMIN_ORDER_SORTS, "created_desc"),
  });

  return { rows: orders, truncated };
}

type RefundStartRow = {
  refund_id: string;
  refund_uid: string;
  order_uid: string;
  payment_key: string;
  amount: number;
  idempotency_key: string;
};

type RefundOrderRow = TossSettlementOrder;

export async function refundPaymentOrderAction(
  orderId: string,
  reason: string
): Promise<RefundPaymentOrderResult> {
  const actor = await requireOwnerAdmin();
  if (!isUuid(orderId)) {
    return { ok: false, message: "환불할 주문을 다시 확인해 주세요." };
  }

  const normalizedReason = reason.trim();
  if (normalizedReason.length < 3 || normalizedReason.length > 200) {
    return { ok: false, message: "환불 사유를 3자 이상 200자 이하로 입력해 주세요." };
  }

  const mode = getPaymentMode();
  if (mode !== "toss_test" && mode !== "toss_live" || !isTossPaymentConfigured()) {
    return { ok: false, message: "현재 결제 실행 환경에서는 Toss 환불을 처리할 수 없습니다." };
  }

  const admin = getAdminClient();
  const order = await loadRefundOrder(admin, orderId);
  if (!order) {
    return { ok: false, message: "환불할 주문 정보를 다시 확인해 주세요." };
  }
  if (order.payment_mode !== null && order.payment_mode !== mode) {
    return {
      ok: false,
      message: "주문의 결제 실행 환경이 현재 서버 설정과 달라 Toss 취소를 보내지 않았습니다.",
    };
  }
  if (order.payment_mode === null) {
    const lookup = order.payment_key
      ? await lookupVerifiedTossPaymentByKey({ paymentKey: order.payment_key, order, mode })
      : await lookupVerifiedTossPaymentByOrderId({ order, mode });
    if (!lookup.ok) {
      return {
        ok: false,
        message: "이전 주문의 Toss 결제 내역을 확인하지 못해 취소를 보내지 않았습니다.",
      };
    }
    if (lookup.payment.status === "CANCELED") {
      const settlement = await settleVerifiedTossPayment({
        admin,
        order,
        payment: lookup.payment,
        mode,
        actorUserId: actor.userId,
        refundUid: null,
        refundReason: normalizedReason,
      });
      return settlement.ok && settlement.kind === "canceled"
        ? {
            ok: true,
            message: `${new Intl.NumberFormat("ko-KR").format(order.amount)}원이 전액 환불되고 이용권이 회수됐습니다.`,
          }
        : { ok: false, message: settlement.ok ? "Toss 취소 상태를 내부 주문에 반영하지 못했습니다." : settlement.message };
    }
    if (lookup.payment.status === "PARTIAL_CANCELED") {
      const settlement = await settleVerifiedTossPayment({
        admin,
        order,
        payment: lookup.payment,
        mode,
        actorUserId: actor.userId,
        refundUid: null,
        refundReason: normalizedReason,
      });
      return {
        ok: false,
        message:
          settlement.ok && settlement.kind === "partial_cancellation_recorded"
            ? "Toss 부분 취소가 감지되어 자동 전액 환불 대신 검토 기록을 남겼습니다."
            : settlement.ok
              ? "Toss 결제 상태가 전액 취소로 확인되지 않아 주문을 새로고침해 주세요."
              : settlement.message,
      };
    }
    const bound = await bindVerifiedLegacyOrderMode({
      admin,
      order,
      payment: lookup.payment,
      mode,
    });
    if (!bound) {
      return {
        ok: false,
        message: "이전 주문의 결제 실행 환경을 확인하지 못해 Toss 취소를 보내지 않았습니다.",
      };
    }
    order.payment_mode = mode;
  }

  const token = crypto.randomUUID();
  const refundUid = `RFD-${token}`;
  const idempotencyKey = `refund-${token}`;
  const { data, error } = await admin.rpc("begin_toss_refund_server", {
    target_order_id: orderId,
    target_actor_user_id: actor.userId,
    target_refund_uid: refundUid,
    target_idempotency_key: idempotencyKey,
    target_reason: normalizedReason,
  });

  if (error) {
    return { ok: false, message: mapRefundStartError(error.code) };
  }

  const refund = (Array.isArray(data) ? data[0] : null) as RefundStartRow | null;
  if (!refund) {
    return { ok: false, message: "환불 요청 정보를 생성하지 못했습니다." };
  }

  let payment: TossPayment | null = null;
  const cancellation = await cancelTossPayment({
    paymentKey: refund.payment_key,
    cancelReason: normalizedReason,
    idempotencyKey: refund.idempotency_key,
  });

  if (cancellation.ok) {
    payment = cancellation.payment;
  } else {
    const lookup = await lookupVerifiedTossPaymentByKey({
      paymentKey: refund.payment_key,
      order,
      mode,
    });
    if (lookup.ok && lookup.payment.status === "CANCELED") {
      payment = lookup.payment;
    } else {
      return {
        ok: false,
        message: `${mapTossCancellationError(cancellation.code)} 환불 복구 기록을 남겼으니 불확실한 상태에서 다시 취소하지 말고 잠시 후 재확인해 주세요.`,
      };
    }
  }

  const settlement = await settleVerifiedTossPayment({
    admin,
    order,
    payment,
    mode,
    actorUserId: actor.userId,
    refundUid: refund.refund_uid,
    refundReason: normalizedReason,
  });

  if (!settlement.ok || settlement.kind !== "canceled") {
    return {
      ok: false,
      message:
        settlement.ok && settlement.kind === "partial_cancellation_recorded"
          ? "Toss 부분 취소가 감지되어 자동 전액 환불 대신 검토 기록을 남겼습니다."
          : settlement.ok
            ? "Toss 결제 상태가 전액 취소로 확인되지 않아 주문을 새로고침해 주세요."
            : settlement.message,
    };
  }

  revalidatePaymentPaths();
  return {
    ok: true,
    message: `${new Intl.NumberFormat("ko-KR").format(refund.amount)}원이 전액 환불되고 이용권이 회수됐습니다.`,
  };
}

export async function reconcilePaymentOrderAction(
  orderId: string
): Promise<RefundPaymentOrderResult> {
  await requireOwnerAdmin();
  if (!isUuid(orderId)) {
    return { ok: false, message: "재확인할 주문을 다시 확인해 주세요." };
  }

  const mode = getPaymentMode();
  if (mode !== "toss_test" && mode !== "toss_live") {
    return { ok: false, message: "현재 결제 실행 환경에서는 Toss 주문을 재확인할 수 없습니다." };
  }

  const admin = getAdminClient();
  const order = await loadRefundOrder(admin, orderId);
  if (!order) {
    return { ok: false, message: "재확인할 주문을 찾지 못했습니다." };
  }

  const lookup = order.payment_key
    ? await lookupVerifiedTossPaymentByKey({ paymentKey: order.payment_key, order, mode })
    : await lookupVerifiedTossPaymentByOrderId({ order, mode });
  if (!lookup.ok) {
    return { ok: false, message: lookup.message };
  }

  const settlement = await settleVerifiedTossPayment({
    admin,
    order,
    payment: lookup.payment,
    mode,
    requireCompletedEntitlement: lookup.payment.status === "DONE",
  });
  if (!settlement.ok) {
    return { ok: false, message: settlement.message };
  }

  if (settlement.kind === "paid") {
    return { ok: true, message: "Toss 결제 완료 상태를 주문에 반영했습니다." };
  }
  if (settlement.kind === "canceled") {
    return { ok: true, message: "Toss 전액 취소 상태를 주문에 반영했습니다." };
  }
  if (settlement.kind === "partial_cancellation_recorded") {
    return { ok: true, message: "Toss 부분 취소를 검토 기록으로 남겼습니다." };
  }
  return { ok: true, message: "Toss 종료 상태를 주문에 반영했습니다." };
}

function mapRefundStartError(code: string | undefined) {
  if (code === "42501") return "전액 환불 권한이 없습니다.";
  if (code === "23505") return "이미 환불됐거나 처리 중인 주문입니다.";
  if (code === "55000") return "결제 완료 상태인 주문만 환불할 수 있습니다.";
  if (code === "P0002") return "환불할 주문을 찾지 못했습니다.";
  return "환불 요청을 시작하지 못했습니다. 주문 상태를 확인해 주세요.";
}

function mapTossCancellationError(code: string) {
  const messages: Record<string, string> = {
    ALREADY_CANCELED_PAYMENT: "이미 취소된 결제입니다. 주문을 새로고침해 주세요.",
    NOT_CANCELABLE_PAYMENT: "현재 취소할 수 없는 결제입니다.",
    FORBIDDEN_REQUEST: "Toss 결제 취소 권한 또는 키 설정을 확인해 주세요.",
    TOSS_API_UNAVAILABLE: "Toss Payments에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  };
  return messages[code] ?? "Toss Payments에서 결제를 취소하지 못했습니다.";
}

async function loadRefundOrder(
  admin: ReturnType<typeof getAdminClient>,
  orderId: string
) {
  const { data, error } = await admin
    .from("orders")
    .select(
      "id, user_id, order_uid, amount, source, status, payment_key, payment_mode, refund_policy_version, refund_policy_agreed_at"
    )
    .eq("id", orderId)
    .maybeSingle<RefundOrderRow>();
  if (error) {
    console.error("Failed to load Toss refund order:", error.code);
    return null;
  }
  return data;
}
