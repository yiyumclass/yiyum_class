import { revalidatePath } from "next/cache";
import { getTossPayment, type TossCancellation, type TossPayment } from "@/lib/payments/toss";
import { isTossPaymentConfigured } from "@/lib/store/free-enrollment";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type WebhookOrderRow = {
  id: string;
  user_id: string;
  order_uid: string;
  amount: number;
  source: "free_checkout" | "payment" | "admin_grant";
  status: "pending" | "paid" | "canceled" | "refunded" | "failed";
  payment_key: string | null;
  refund_policy_version: string | null;
  refund_policy_agreed_at: string | null;
};

export async function POST(request: Request) {
  if (!isTossPaymentConfigured()) {
    return Response.json({ ok: false }, { status: 503 });
  }

  const event = await readPaymentEvent(request);
  if (!event) {
    return Response.json({ ok: true }, { status: 200 });
  }
  if (event.status === "PARTIAL_CANCELED") {
    // 현재 상품은 이용권 전체를 판매하므로 부분 환불을 제공하지 않는다.
    // Toss 콘솔에서 수동 부분 취소가 발생하면 접근권은 유지하고 운영 로그로 남긴다.
    console.error("Unsupported partial Toss cancellation received:", event.orderId);
    return Response.json({ ok: true }, { status: 200 });
  }
  if (event.status !== "DONE" && event.status !== "CANCELED") {
    return Response.json({ ok: true }, { status: 200 });
  }

  const admin = getAdminClient();
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select(
      "id, user_id, order_uid, amount, source, status, payment_key, refund_policy_version, refund_policy_agreed_at"
    )
    .eq("order_uid", event.orderId)
    .maybeSingle<WebhookOrderRow>();

  if (orderError) {
    console.error("Failed to load order from Toss webhook:", orderError.code);
    return Response.json({ ok: false }, { status: 500 });
  }
  if (!order || order.source !== "payment") {
    return Response.json({ ok: true }, { status: 200 });
  }
  if (order.payment_key !== null && order.payment_key !== event.paymentKey) {
    return Response.json({ ok: false }, { status: 409 });
  }

  // 웹훅 본문만으로 금전·이용권 상태를 바꾸지 않고 Toss 조회 결과를 다시 검증한다.
  const lookup = await getTossPayment(event.paymentKey);
  if (!lookup.ok) {
    return Response.json({ ok: false }, { status: lookup.retryable ? 503 : 400 });
  }
  const payment = lookup.payment;
  if (
    payment.status !== event.status ||
    payment.paymentKey !== event.paymentKey ||
    payment.orderId !== order.order_uid ||
    payment.totalAmount !== order.amount
  ) {
    return Response.json({ ok: false }, { status: 409 });
  }

  if (event.status === "DONE") {
    return handleApprovedPayment(admin, order, payment);
  }
  return handleCanceledPayment(admin, order, payment);
}

async function handleApprovedPayment(
  admin: ReturnType<typeof getAdminClient>,
  order: WebhookOrderRow,
  payment: TossPayment
) {
  if (order.status === "paid" && order.payment_key === payment.paymentKey) {
    return Response.json({ ok: true }, { status: 200 });
  }
  if (order.status !== "pending" && order.status !== "failed") {
    return Response.json({ ok: false }, { status: 409 });
  }
  if (!order.refund_policy_version || !order.refund_policy_agreed_at) {
    return Response.json({ ok: false }, { status: 409 });
  }

  await admin
    .from("orders")
    .update({ payment_key: payment.paymentKey, approved_at: payment.approvedAt })
    .eq("id", order.id)
    .in("status", ["pending", "failed"]);

  const { error } = await admin.rpc("complete_toss_payment_server", {
    target_user_id: order.user_id,
    target_order_uid: order.order_uid,
    target_payment_key: payment.paymentKey,
    target_amount: order.amount,
    target_approved_at: payment.approvedAt,
  });
  if (error) {
    console.error("Failed to fulfill approved Toss webhook payment:", error.code);
    return Response.json({ ok: false }, { status: 500 });
  }

  revalidatePaymentPaths();
  return Response.json({ ok: true }, { status: 200 });
}

async function handleCanceledPayment(
  admin: ReturnType<typeof getAdminClient>,
  order: WebhookOrderRow,
  payment: TossPayment
) {
  const cancellation = resolveFullCancellation(payment, order.amount);
  if (!cancellation || (order.status !== "paid" && order.status !== "refunded")) {
    return Response.json({ ok: false }, { status: 409 });
  }

  const { error } = await admin.rpc("complete_toss_refund_server", {
    target_order_uid: order.order_uid,
    target_payment_key: payment.paymentKey,
    target_amount: order.amount,
    target_canceled_at: cancellation.canceledAt,
    target_transaction_key: cancellation.transactionKey,
    target_refund_uid: null,
    target_actor_user_id: null,
    target_reason: cancellation.cancelReason,
  });
  if (error) {
    console.error("Failed to reconcile canceled Toss payment:", error.code);
    return Response.json({ ok: false }, { status: 500 });
  }

  revalidatePaymentPaths();
  return Response.json({ ok: true }, { status: 200 });
}

function resolveFullCancellation(payment: TossPayment, expectedAmount: number) {
  if (payment.status !== "CANCELED" || payment.balanceAmount !== 0) return null;
  const completed = payment.cancels.filter((item) => item.cancelStatus === "DONE");
  if (completed.reduce((total, item) => total + item.cancelAmount, 0) !== expectedAmount) {
    return null;
  }
  return completed.sort(
    (a, b) => new Date(b.canceledAt).getTime() - new Date(a.canceledAt).getTime()
  )[0] as TossCancellation | undefined;
}

function revalidatePaymentPaths() {
  revalidatePath("/admin/orders");
  revalidatePath("/admin/members");
  revalidatePath("/my");
  revalidatePath("/learn", "layout");
}

async function readPaymentEvent(request: Request) {
  const payload: unknown = await request.json().catch(() => null);
  if (!isRecord(payload) || payload.eventType !== "PAYMENT_STATUS_CHANGED") return null;
  const data = payload.data;
  if (!isRecord(data)) return null;
  if (
    typeof data.paymentKey !== "string" ||
    data.paymentKey.length < 1 ||
    data.paymentKey.length > 200 ||
    typeof data.orderId !== "string" ||
    !/^[A-Za-z0-9_-]{6,64}$/.test(data.orderId) ||
    typeof data.status !== "string"
  ) {
    return null;
  }
  return {
    paymentKey: data.paymentKey,
    orderId: data.orderId,
    status: data.status,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
