import "server-only";

import { requireOwnerAdmin } from "@/lib/admin/auth";
import { getAdminClient } from "@/lib/supabase/admin";

export async function loadPaymentNotificationOverview() {
  await requireOwnerAdmin();
  const enabled = process.env.SOLAPI_PAYMENT_NOTIFICATIONS_ENABLED === "true";
  const admin = getAdminClient();
  const [health, queue] = await Promise.all([
    admin.rpc("get_payment_notification_health"),
    admin.from("payment_notifications")
      .select("order_id,status,error_code,provider_status_code,orders!inner(order_uid,status)")
      .eq("orders.status", "paid")
      .in("status", ["waiting_contact", "unknown", "review", "delivery_failed", "failed"])
      .order("created_at", { ascending: true }).limit(10)
      .returns<{ order_id: string; status: string; error_code: string | null; provider_status_code: string | null; orders: { order_uid: string } }[]>(),
  ]);
  if (health.error || queue.error || !health.data?.[0]) return { available: false as const, enabled };
  return {
    available: true as const, enabled,
    pendingCount: Number(health.data[0].pending_count),
    attentionCount: Number(health.data[0].attention_count),
    deliveredCount: Number(health.data[0].delivered_count),
    items: queue.data ?? [],
  };
}
