import "server-only";

import { requireOwnerAdmin } from "@/lib/admin/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { getPaymentMode } from "@/lib/store/payment-mode";

export type PaymentRecoveryItem = {
  orderId: string;
  orderUid: string;
  mode: string | null;
  status: "ready" | "processing" | "review";
  attempts: number;
  errorCode: string | null;
};

export type PaymentRecoveryOverview = {
  available: boolean;
  pendingCount: number;
  reviewCount: number;
  overdueCount: number;
  items: PaymentRecoveryItem[];
};

type RecoveryRow = {
  order_id: string;
  status: PaymentRecoveryItem["status"];
  attempt_count: number;
  last_error_code: string | null;
  orders: { order_uid: string; payment_mode: string | null };
};

export async function loadPaymentRecoveryOverview(): Promise<PaymentRecoveryOverview> {
  await requireOwnerAdmin();
  const unavailable: PaymentRecoveryOverview = {
    available: false, pendingCount: 0, reviewCount: 0, overdueCount: 0, items: [],
  };
  const mode = getPaymentMode();
  if (mode !== "toss_test" && mode !== "toss_live") return unavailable;
  const admin = getAdminClient();
  const [health, queue] = await Promise.all([
    admin.rpc("get_toss_payment_recovery_health", { target_mode: mode }),
    admin.from("payment_recovery_jobs")
      .select("order_id, status, attempt_count, last_error_code, orders!inner(order_uid, payment_mode)")
      .in("status", ["ready", "processing", "review"])
      .or(`payment_mode.eq.${mode},payment_mode.is.null`, { referencedTable: "orders" })
      .order("created_at", { ascending: true })
      .limit(20)
      .returns<RecoveryRow[]>(),
  ]);
  const counts = Array.isArray(health.data) ? health.data[0] : null;
  if (health.error || queue.error || !counts) {
    console.error("Payment recovery overview unavailable:", health.error?.code ?? queue.error?.code ?? "EMPTY_HEALTH");
    return unavailable;
  }
  return {
    available: true,
    pendingCount: Number(counts.pending_count),
    reviewCount: Number(counts.review_count),
    overdueCount: Number(counts.overdue_count),
    items: (queue.data ?? []).map((row) => ({
      orderId: row.order_id,
      orderUid: row.orders.order_uid,
      mode: row.orders.payment_mode,
      status: row.status,
      attempts: row.attempt_count,
      errorCode: row.last_error_code,
    })),
  };
}
