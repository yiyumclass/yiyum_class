"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireOwnerAdmin } from "@/lib/admin/auth";
import {
  readOption,
  readParam,
  resolvePeriodStart,
} from "@/lib/admin/list-params";
import {
  ADMIN_ORDER_PERIODS,
  ADMIN_ORDER_SORTS,
  ADMIN_ORDER_SOURCE_FILTERS,
  ADMIN_ORDER_STATUS_FILTERS,
  loadAdminOrdersForExport,
  type AdminOrder,
} from "@/lib/admin/orders";
import { resolveFullCancellation } from "@/lib/payments/toss-verification";
import {
  cancelTossPayment,
  getTossPayment,
  type TossPayment,
} from "@/lib/payments/toss";
import { getAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation/safe-input";

export type RefundPaymentOrderResult = {
  ok: boolean;
  message: string;
};

/** 화면이 URL에 걸어 둔 조회 조건. 클라이언트가 보낸 값이라 그대로 믿지 않는다. */
export type ExportAdminOrdersInput = {
  q?: string;
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

  const token = crypto.randomUUID();
  const refundUid = `RFD-${token}`;
  const idempotencyKey = `refund-${token}`;
  const admin = getAdminClient();
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
    // Toss 취소 성공 직후 응답만 유실된 경우를 조회로 복구한다.
    const lookup = await getTossPayment(refund.payment_key);
    if (lookup.ok && lookup.payment.status === "CANCELED") {
      payment = lookup.payment;
    } else {
      await admin.rpc("fail_toss_refund_server", {
        target_refund_uid: refund.refund_uid,
        target_error_code: cancellation.code,
        target_error_message: cancellation.message,
      });
      return {
        ok: false,
        message: mapTossCancellationError(cancellation.code),
      };
    }
  }

  const completedCancellation = resolveFullCancellation(payment, refund.amount);
  if (
    payment.paymentKey !== refund.payment_key ||
    payment.orderId !== refund.order_uid ||
    payment.totalAmount !== refund.amount ||
    !completedCancellation
  ) {
    await admin.rpc("fail_toss_refund_server", {
      target_refund_uid: refund.refund_uid,
      target_error_code: "REFUND_VERIFICATION_FAILED",
      target_error_message: "Toss 전액 취소 결과가 주문과 일치하지 않습니다.",
    });
    return {
      ok: false,
      message: "Toss 취소 결과를 주문과 대조하지 못했습니다. 결제 내역을 확인해 주세요.",
    };
  }

  const { data: completion, error: completionError } = await admin.rpc(
    "complete_toss_refund_server",
    {
      target_order_uid: refund.order_uid,
      target_payment_key: refund.payment_key,
      target_amount: refund.amount,
      target_canceled_at: completedCancellation.canceledAt,
      target_transaction_key: completedCancellation.transactionKey,
      target_refund_uid: refund.refund_uid,
      target_actor_user_id: actor.userId,
      target_reason: normalizedReason,
    }
  );

  if (completionError || !Array.isArray(completion) || completion.length === 0) {
    console.error("Toss cancellation succeeded but refund persistence failed:", completionError?.code);
    return {
      ok: false,
      message:
        "Toss 취소는 완료됐지만 내부 반영을 재확인하고 있습니다. 다시 환불하지 말고 주문을 새로고침해 주세요.",
    };
  }

  revalidateRefundPaths();
  return {
    ok: true,
    message: `${new Intl.NumberFormat("ko-KR").format(refund.amount)}원이 전액 환불되고 이용권이 회수됐습니다.`,
  };
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

function revalidateRefundPaths() {
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/members");
  revalidatePath("/my");
  revalidatePath("/learn", "layout");
}
