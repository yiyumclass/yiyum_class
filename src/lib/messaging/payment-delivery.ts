import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { lookupPaymentDelivery } from "./solapi-delivery";

type DeliveryRow = {
  order_id: string;
  attempt_id: string | null;
  status: string;
  template_id: string | null;
  provider_message_id: string | null;
  provider_group_id: string | null;
  send_started_at: string | null;
  updated_at: string;
  orders: { order_uid: string };
};

export async function reconcilePaymentNotificationDeliveries() {
  if (process.env.SOLAPI_PAYMENT_NOTIFICATIONS_ENABLED !== "true") return 0;
  const apiKey = process.env.SOLAPI_API_KEY?.trim();
  const apiSecret = process.env.SOLAPI_API_SECRET?.trim();
  const pfId = process.env.SOLAPI_PF_ID?.trim();
  if (!apiKey || !apiSecret || !pfId) throw new Error("NOTIFICATION_CONFIGURATION_MISSING");
  const admin = getAdminClient();
  const { data, error } = await admin.from("payment_notifications")
    .select("order_id,attempt_id,status,template_id,provider_message_id,provider_group_id,send_started_at,updated_at,orders!inner(order_uid)")
    .in("status", ["accepted", "sending", "unknown"])
    .lte("delivery_check_after", new Date().toISOString())
    .order("delivery_check_after", { ascending: true }).limit(5).returns<DeliveryRow[]>();
  if (error) throw new Error("NOTIFICATION_DELIVERY_QUEUE_UNAVAILABLE");
  const results = await Promise.all((data ?? []).map(async row => {
    const checkedAt = new Date().toISOString();
    const nextCheck = new Date(Date.now() + 5 * 60_000).toISOString();
    try {
      const result = await lookupPaymentDelivery({ apiKey, apiSecret, pfId }, {
        orderUid: row.orders.order_uid, templateId: row.template_id,
        messageId: row.provider_message_id, groupId: row.provider_group_id,
        startedAt: row.send_started_at ?? row.updated_at,
      });
      const { data: updated, error: updateError } = await admin.from("payment_notifications").update({
        status: result.status, error_code: result.code, provider_status_code: result.providerCode,
        provider_message_id: result.messageId ?? row.provider_message_id,
        provider_group_id: result.groupId ?? row.provider_group_id,
        delivered_at: result.deliveredAt ?? null, delivery_checked_at: checkedAt,
        delivery_check_after: nextCheck, updated_at: checkedAt,
      }).eq("order_id", row.order_id).eq("status", row.status).eq("updated_at", row.updated_at).select("order_id");
      if (updateError) throw new Error("NOTIFICATION_DELIVERY_PERSIST_FAILED");
      if (updated?.length && ["delivery_failed", "review"].includes(result.status)) console.error("Payment notification delivery needs attention:", result.code, row.order_id);
      return updated?.length === 1;
    } catch {
      const { error: deferError } = await admin.from("payment_notifications").update({ delivery_check_after: nextCheck })
        .eq("order_id", row.order_id).eq("status", row.status).eq("updated_at", row.updated_at);
      console.error("Payment notification delivery check failed:", row.order_id, deferError?.code ?? "LOOKUP_OR_PERSIST_FAILED");
      return false;
    }
  }));
  return results.filter(Boolean).length;
}
