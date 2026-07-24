import { revalidatePath } from "next/cache";
import { readLimitedJson } from "@/lib/http/request-body";
import { getTossPayment, type TossCancellation, type TossPayment } from "@/lib/payments/toss";
import { isTossPaymentConfigured } from "@/lib/store/free-enrollment";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const WEBHOOK_BODY_LIMIT_BYTES = 64 * 1024;
const WEBHOOK_LOOKUP_WINDOW_MS = 60 * 1000;
const WEBHOOK_LOOKUP_MAX_PER_IP = 60;
const WEBHOOK_LOOKUP_MAX_PER_PAYMENT = 10;

const webhookLookupBuckets = new Map<string, { count: number; resetAt: number }>();

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

  const payload = await readLimitedJson(request, {
    limitBytes: WEBHOOK_BODY_LIMIT_BYTES,
  });
  if (!payload.ok) {
    return Response.json({ ok: false, code: payload.code }, { status: payload.status });
  }

  const eventResult = readPaymentEvent(payload.value);
  if (!eventResult.ok) {
    const status = eventResult.reason === "unsupported_event" ? 200 : 400;
    return Response.json({ ok: status === 200, ignored: eventResult.reason }, { status });
  }
  const event = eventResult.event;
  if (!isSupportedPaymentStatus(event.status)) {
    return Response.json({ ok: true, ignored: "unsupported_status" }, { status: 200 });
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

  if (!isWebhookLookupAllowed(request, event.paymentKey)) {
    return Response.json({ ok: false, code: "RATE_LIMITED" }, { status: 429 });
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
  if (event.status === "CANCELED") {
    return handleCanceledPayment(admin, order, payment);
  }
  return handlePartialCanceledPayment(admin, order, payment);
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

async function handlePartialCanceledPayment(
  admin: ReturnType<typeof getAdminClient>,
  order: WebhookOrderRow,
  payment: TossPayment
) {
  const cancellation = resolveLatestCompletedCancellation(payment);
  if (!cancellation || cancellation.cancelAmount >= order.amount) {
    return Response.json({ ok: false }, { status: 409 });
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
    return Response.json({ ok: false }, { status: 500 });
  }

  revalidatePaymentPaths();
  return Response.json({ ok: true, ignored: "partial_cancellation_recorded" }, { status: 200 });
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

function resolveLatestCompletedCancellation(payment: TossPayment) {
  return payment.cancels
    .filter((item) => item.cancelStatus === "DONE")
    .sort((a, b) => new Date(b.canceledAt).getTime() - new Date(a.canceledAt).getTime())[0] as
    | TossCancellation
    | undefined;
}

function revalidatePaymentPaths() {
  revalidatePath("/admin/orders");
  revalidatePath("/admin/members");
  revalidatePath("/my");
  revalidatePath("/learn", "layout");
}

function readPaymentEvent(payload: unknown):
  | { ok: true; event: { paymentKey: string; orderId: string; status: string } }
  | { ok: false; reason: "unsupported_event" | "invalid_payload" } {
  if (!isRecord(payload)) return { ok: false, reason: "invalid_payload" };
  if (payload.eventType !== "PAYMENT_STATUS_CHANGED") {
    return { ok: false, reason: "unsupported_event" };
  }
  const data = payload.data;
  if (!isRecord(data)) return { ok: false, reason: "invalid_payload" };
  if (
    typeof data.paymentKey !== "string" ||
    data.paymentKey.length < 1 ||
    data.paymentKey.length > 200 ||
    typeof data.orderId !== "string" ||
    !/^[A-Za-z0-9_-]{6,64}$/.test(data.orderId) ||
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

function isSupportedPaymentStatus(status: string) {
  return status === "DONE" || status === "CANCELED" || status === "PARTIAL_CANCELED";
}

function isWebhookLookupAllowed(request: Request, paymentKey: string) {
  const now = Date.now();
  const clientIp = getClientIp(request);
  pruneExpiredBuckets(now);

  return (
    consumeWebhookBucket(`ip:${clientIp}`, WEBHOOK_LOOKUP_MAX_PER_IP, now) &&
    consumeWebhookBucket(`payment:${paymentKey}`, WEBHOOK_LOOKUP_MAX_PER_PAYMENT, now)
  );
}

function consumeWebhookBucket(key: string, limit: number, now: number) {
  const bucket = webhookLookupBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    webhookLookupBuckets.set(key, { count: 1, resetAt: now + WEBHOOK_LOOKUP_WINDOW_MS });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

function pruneExpiredBuckets(now: number) {
  if (webhookLookupBuckets.size < 500) return;
  for (const [key, bucket] of webhookLookupBuckets) {
    if (bucket.resetAt <= now) webhookLookupBuckets.delete(key);
  }
}

function getClientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
