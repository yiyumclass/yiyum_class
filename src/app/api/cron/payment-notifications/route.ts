import { dispatchPaymentNotification } from "@/lib/messaging/payment-notifications";
import { reconcilePaymentNotificationDeliveries } from "@/lib/messaging/payment-delivery";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ ok: false }, { status: 401 });
  if (process.env.SOLAPI_PAYMENT_NOTIFICATIONS_ENABLED !== "true") return Response.json({ ok: true, enabled: false });
  try {
    const deliveriesChecked = await reconcilePaymentNotificationDeliveries();
    const sent = await Promise.all(Array.from({ length: 3 }, () => dispatchPaymentNotification()));
    const { data, error } = await getAdminClient().rpc("get_payment_notification_health");
    if (error || !data?.[0]) throw new Error("NOTIFICATION_HEALTH_UNAVAILABLE");
    const health = data[0];
    if (Number(health.attention_count) > 0) console.error("Payment notifications need review:", Number(health.attention_count));
    return Response.json({ ok: true, deliveriesChecked, processed: sent.filter(Boolean).length, health }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("Payment notification cron failed.");
    return Response.json({ ok: false }, { status: 503 });
  }
}
