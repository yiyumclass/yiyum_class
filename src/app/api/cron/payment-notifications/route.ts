import { dispatchPaymentNotification } from "@/lib/messaging/payment-notifications";
import { reconcilePaymentNotificationDeliveries } from "@/lib/messaging/payment-delivery";
import { getAdminClient } from "@/lib/supabase/admin";
import { adminNotificationsEnabled, reconcileAdminNotificationDeliveries } from "@/lib/messaging/admin-notifications";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ ok: false }, { status: 401 });
  const paymentEnabled = process.env.SOLAPI_PAYMENT_NOTIFICATIONS_ENABLED === "true";
  if (!paymentEnabled && !adminNotificationsEnabled()) return Response.json({ ok: true, enabled: false });
  const adminDelivery = reconcileAdminNotificationDeliveries().then(
    checked => ({ ok: true, checked }),
    () => { console.error("Admin notification delivery check failed."); return { ok: false, checked: 0 }; }
  );
  try {
    if (!paymentEnabled) {
      const admin = await adminDelivery;
      return Response.json({ ok: admin.ok, admin }, { status: admin.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
    }
    const deliveriesChecked = await reconcilePaymentNotificationDeliveries();
    const sent = await Promise.all(Array.from({ length: 3 }, () => dispatchPaymentNotification()));
    const { data, error } = await getAdminClient().rpc("get_payment_notification_health");
    if (error || !data?.[0]) throw new Error("NOTIFICATION_HEALTH_UNAVAILABLE");
    const health = data[0];
    if (Number(health.attention_count) > 0) console.error("Payment notifications need review:", Number(health.attention_count));
    const admin = await adminDelivery;
    return Response.json({ ok: admin.ok, deliveriesChecked, processed: sent.filter(Boolean).length, health, admin }, { status: admin.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    await adminDelivery;
    console.error("Payment notification cron failed.");
    return Response.json({ ok: false }, { status: 503 });
  }
}
