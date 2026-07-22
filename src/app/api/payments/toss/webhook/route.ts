import { getTossPayment } from "@/lib/payments/toss";
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
};

export async function POST(request: Request) {
  if (!isTossPaymentConfigured()) {
    return Response.json({ ok: false }, { status: 503 });
  }

  const event = await readPaymentEvent(request);
  if (!event || event.status !== "DONE") {
    return Response.json({ ok: true }, { status: 200 });
  }

  const admin = getAdminClient();
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, user_id, order_uid, amount, source, status, payment_key")
    .eq("order_uid", event.orderId)
    .maybeSingle<WebhookOrderRow>();

  if (orderError) {
    console.error("Failed to load order from Toss webhook:", orderError.code);
    return Response.json({ ok: false }, { status: 500 });
  }
  if (!order || order.source !== "payment") {
    return Response.json({ ok: true }, { status: 200 });
  }
  if (order.status === "paid" && order.payment_key === event.paymentKey) {
    return Response.json({ ok: true }, { status: 200 });
  }
  if (
    (order.status !== "pending" && order.status !== "failed") ||
    (order.payment_key !== null && order.payment_key !== event.paymentKey)
  ) {
    return Response.json({ ok: false }, { status: 409 });
  }

  // 일반 결제 웹훅에는 서명 헤더가 없으므로 API 조회 결과만 신뢰한다.
  const lookup = await getTossPayment(event.paymentKey);
  if (!lookup.ok) {
    return Response.json({ ok: false }, { status: lookup.retryable ? 503 : 400 });
  }
  const payment = lookup.payment;
  if (
    payment.status !== "DONE" ||
    payment.paymentKey !== event.paymentKey ||
    payment.orderId !== order.order_uid ||
    payment.totalAmount !== order.amount
  ) {
    return Response.json({ ok: false }, { status: 409 });
  }

  await admin
    .from("orders")
    .update({ payment_key: payment.paymentKey, approved_at: payment.approvedAt })
    .eq("id", order.id)
    .in("status", ["pending", "failed"]);

  const { error: completionError } = await admin.rpc("complete_toss_payment_server", {
    target_user_id: order.user_id,
    target_order_uid: order.order_uid,
    target_payment_key: payment.paymentKey,
    target_amount: order.amount,
    target_approved_at: payment.approvedAt,
  });
  if (completionError) {
    console.error("Failed to fulfill approved Toss webhook payment:", completionError.code);
    return Response.json({ ok: false }, { status: 500 });
  }

  return Response.json({ ok: true }, { status: 200 });
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
