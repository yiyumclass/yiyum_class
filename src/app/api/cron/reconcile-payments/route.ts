import {
  lookupVerifiedTossPaymentByOrderId,
  shouldFinishRecoveryAsReview,
  settleVerifiedTossPayment,
  type TossSettlementOrder,
} from "@/lib/payments/reconciliation";
import { confirmTossPayment } from "@/lib/payments/toss";
import { getPaymentMode, isTossPaymentConfigured } from "@/lib/store/free-enrollment";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

type RecoveryJobRow = {
  order_uid: string;
  confirmation_key: string;
  idempotency_key: string;
  lease_token: string;
  can_confirm: boolean;
  operation: "confirmation" | "refund" | "reconcile";
};

type RecoveryHealthRow = {
  pending_count: number;
  review_count: number;
  overdue_count: number;
};

const DEFAULT_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 5;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const mode = getPaymentMode();
  if (mode !== "toss_test" && mode !== "toss_live" || !isTossPaymentConfigured()) {
    return Response.json({ ok: false, message: "payment_not_configured" }, { status: 503 });
  }

  const limit = readLimit(request);
  const admin = getAdminClient();
  const jobs = await claimRecoveryJobs(admin, mode, limit);
  if (!jobs.ok) {
    return Response.json({ ok: false, message: "claim_failed" }, { status: 500 });
  }

  const results = await Promise.all(
    jobs.rows.map((job) => processRecoveryJobSafely(admin, job, mode))
  );

  const health = await loadRecoveryHealth(admin, mode);
  if (health.ok && (health.row.review_count > 0 || health.row.overdue_count > 0)) {
    console.error("Toss payment recovery needs review:", {
      mode,
      reviewCount: health.row.review_count,
      overdueCount: health.row.overdue_count,
    });
  }

  return Response.json(
    {
      ok: true,
      processed: results.length,
      results,
      health: health.ok ? health.row : null,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}

async function processRecoveryJobSafely(
  admin: ReturnType<typeof getAdminClient>,
  job: RecoveryJobRow,
  mode: "toss_test" | "toss_live"
) {
  try {
    return await processRecoveryJob(admin, job, mode);
  } catch (error) {
    console.error("Toss payment recovery job threw before lease finish:", {
      orderUid: job.order_uid,
      error: error instanceof Error ? error.name : "unknown",
    });
    return { orderUid: job.order_uid, ok: false, code: "JOB_EXCEPTION" };
  }
}

async function processRecoveryJob(
  admin: ReturnType<typeof getAdminClient>,
  job: RecoveryJobRow,
  mode: "toss_test" | "toss_live"
) {
  const order = await loadOrderByUid(admin, job.order_uid);
  if (!order) {
    await finishRecovery(admin, job, "ORDER_NOT_FOUND", true);
    return { orderUid: job.order_uid, ok: false, code: "ORDER_NOT_FOUND" };
  }

  const lookup = await lookupVerifiedTossPaymentByOrderId({ order, mode });
  if (!lookup.ok) {
    await finishRecovery(admin, job, lookup.errorCode ?? "LOOKUP_FAILED", lookup.kind === "mismatch");
    return { orderUid: job.order_uid, ok: false, code: lookup.errorCode ?? "LOOKUP_FAILED" };
  }

  let payment = lookup.payment;
  if (job.operation === "refund" && payment.status !== "CANCELED" && payment.status !== "PARTIAL_CANCELED") {
    await finishRecovery(admin, job, `TOSS_STATUS_${payment.status}`, false);
    return { orderUid: job.order_uid, ok: false, code: `TOSS_STATUS_${payment.status}` };
  }

  if (
    job.can_confirm &&
    job.operation === "confirmation" &&
    payment.status === "IN_PROGRESS" &&
    payment.paymentKey === job.confirmation_key
  ) {
    const confirmation = await confirmTossPayment({
      paymentKey: job.confirmation_key,
      orderId: order.order_uid,
      amount: order.amount,
      idempotencyKey: job.idempotency_key,
    });
    if (confirmation.ok) {
      payment = confirmation.payment;
    } else {
      await finishRecovery(admin, job, confirmation.code, false);
      return { orderUid: job.order_uid, ok: false, code: confirmation.code };
    }
  }

  const settlement = await settleVerifiedTossPayment({
    admin,
    order,
    payment,
    mode,
    requireCompletedEntitlement: payment.status === "DONE",
  });
  if (!settlement.ok) {
    await finishRecovery(
      admin,
      job,
      settlement.errorCode ?? "SETTLEMENT_FAILED",
      shouldFinishRecoveryAsReview(settlement)
    );
    return { orderUid: job.order_uid, ok: false, code: settlement.errorCode ?? "SETTLEMENT_FAILED" };
  }

  return { orderUid: job.order_uid, ok: true, settled: settlement.kind };
}

async function claimRecoveryJobs(
  admin: ReturnType<typeof getAdminClient>,
  mode: "toss_test" | "toss_live",
  limit: number
) {
  const { data, error } = await admin.rpc("claim_toss_payment_recovery", {
    target_mode: mode,
    target_limit: limit,
  });
  if (error) {
    console.error("Failed to claim Toss payment recovery jobs:", error.code);
    return { ok: false as const, rows: [] };
  }
  return { ok: true as const, rows: (Array.isArray(data) ? data : []) as RecoveryJobRow[] };
}

async function loadRecoveryHealth(
  admin: ReturnType<typeof getAdminClient>,
  mode: "toss_test" | "toss_live"
) {
  const { data, error } = await admin.rpc("get_toss_payment_recovery_health", {
    target_mode: mode,
  });
  if (error) {
    console.error("Failed to load Toss payment recovery health:", error.code);
    return { ok: false as const, row: null };
  }
  const row = (Array.isArray(data) ? data[0] : null) as RecoveryHealthRow | null;
  return {
    ok: true as const,
    row: row ?? { pending_count: 0, review_count: 0, overdue_count: 0 },
  };
}

async function loadOrderByUid(
  admin: ReturnType<typeof getAdminClient>,
  orderUid: string
) {
  const { data, error } = await admin
    .from("orders")
    .select(
      "id, user_id, order_uid, amount, source, status, payment_key, payment_mode, refund_policy_version, refund_policy_agreed_at"
    )
    .eq("order_uid", orderUid)
    .maybeSingle<TossSettlementOrder>();
  if (error) {
    console.error("Failed to load Toss recovery order:", error.code);
    return null;
  }
  return data;
}

async function finishRecovery(
  admin: ReturnType<typeof getAdminClient>,
  job: RecoveryJobRow,
  errorCode: string,
  review: boolean
) {
  const { error } = await admin.rpc("finish_toss_payment_recovery", {
    target_order_uid: job.order_uid,
    target_lease_token: job.lease_token,
    target_error_code: errorCode,
    target_review: review,
  });
  if (error) {
    console.error("Failed to finish Toss payment recovery job:", error.code);
  }
}

function readLimit(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("limit"));
  if (!Number.isInteger(value) || value < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(value, MAX_BATCH_SIZE);
}
