"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import {
  cancelTossPayment,
  getTossPayment,
  type TossCancellation,
  type TossPayment,
} from "@/lib/payments/toss";
import { getAdminClient } from "@/lib/supabase/admin";

export type RefundPaymentOrderResult = {
  ok: boolean;
  message: string;
};

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
  const actor = await requireAdmin();
  if (actor.role !== "owner") {
    return { ok: false, message: "전액 환불은 소유자 관리자만 실행할 수 있습니다." };
  }
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

function resolveFullCancellation(payment: TossPayment, expectedAmount: number) {
  if (payment.status !== "CANCELED" || payment.balanceAmount !== 0) return null;

  const completed = payment.cancels.filter((item) => item.cancelStatus === "DONE");
  const canceledAmount = completed.reduce((total, item) => total + item.cancelAmount, 0);
  if (canceledAmount !== expectedAmount) return null;

  return completed.sort(
    (a, b) => new Date(b.canceledAt).getTime() - new Date(a.canceledAt).getTime()
  )[0] as TossCancellation | undefined;
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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}
