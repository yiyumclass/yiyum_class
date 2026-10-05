import { after } from "next/server";
import { dispatchPaymentNotification } from "@/lib/messaging/payment-notifications";
import { FixedWindowRateLimiter } from "@/lib/http/fixed-window-rate-limiter";
import { readLimitedJson } from "@/lib/http/request-body";
import {
  lookupVerifiedTossPaymentByOrderId,
  settleVerifiedTossPayment,
  type TossSettlementOrder,
} from "@/lib/payments/reconciliation";
import {
  isSupportedPaymentStatus,
  readPaymentEvent,
} from "@/lib/payments/toss-verification";
import { getPaymentMode, isTossPaymentConfigured } from "@/lib/store/free-enrollment";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const WEBHOOK_BODY_LIMIT_BYTES = 64 * 1024;
const WEBHOOK_LOOKUP_WINDOW_MS = 60 * 1000;
const WEBHOOK_LOOKUP_MAX_PER_IP = 60;
const WEBHOOK_LOOKUP_MAX_PER_PAYMENT = 10;
const WEBHOOK_LOOKUP_MAX_BUCKETS = 2_048;

const webhookLookupLimiter = new FixedWindowRateLimiter(
  WEBHOOK_LOOKUP_WINDOW_MS,
  WEBHOOK_LOOKUP_MAX_BUCKETS
);

export async function POST(request: Request) {
  const mode = getPaymentMode();
  if (mode !== "toss_test" && mode !== "toss_live") {
    return Response.json({ ok: false }, { status: 503 });
  }
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

  if (!isWebhookLookupAllowed(request, event.paymentKey)) {
    return Response.json({ ok: false, code: "RATE_LIMITED" }, { status: 429 });
  }

  const admin = getAdminClient();
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select(
      "id, user_id, order_uid, amount, source, status, payment_key, payment_mode, refund_policy_version, refund_policy_agreed_at"
    )
    .eq("order_uid", event.orderId)
    .maybeSingle<TossSettlementOrder>();

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

  const lookup = await lookupVerifiedTossPaymentByOrderId({ order, mode });
  if (!lookup.ok) {
    return Response.json({ ok: false, code: lookup.errorCode }, { status: lookup.retryable ? 503 : 409 });
  }
  if (lookup.payment.paymentKey !== event.paymentKey) {
    return Response.json({ ok: false }, { status: 409 });
  }

  const settlement = await settleVerifiedTossPayment({
    admin,
    order,
    payment: lookup.payment,
    mode,
    requireCompletedEntitlement: lookup.payment.status === "DONE",
  });
  if (!settlement.ok) {
    return Response.json(
      { ok: false, code: settlement.errorCode },
      { status: settlement.retryable ? 503 : 409 }
    );
  }

  if (settlement.kind === "paid") {
    after(async () => {
      await dispatchPaymentNotification(order.order_uid);
    });
  }

  return Response.json({ ok: true, settled: settlement.kind }, { status: 200 });
}

function isWebhookLookupAllowed(request: Request, paymentKey: string) {
  const clientIp = getClientIp(request);
  return webhookLookupLimiter.allows([
    { key: `ip:${clientIp}`, limit: WEBHOOK_LOOKUP_MAX_PER_IP },
    { key: `payment:${paymentKey}`, limit: WEBHOOK_LOOKUP_MAX_PER_PAYMENT },
  ]);
}

function getClientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}
