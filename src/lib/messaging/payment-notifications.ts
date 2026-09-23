import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { readAuthUserMobileNumber } from "@/lib/messaging/phone";
import { readAuthUserDisplayName } from "@/lib/messaging/profile";
import { buildPaymentMessage, deliverPaymentMessage, type PaymentMessageOrder } from "@/lib/messaging/payment-message";
import { PaymentMessageRejected, sendPaymentMessageOnce } from "@/lib/messaging/solapi-payment-transport";

/** 결제 응답 밖(after)에서 실행한다. 알림 장애는 결제 성공 결과를 바꾸지 않는다. */
export async function dispatchPaymentNotification(orderUid?: string): Promise<boolean> {
  if (process.env.SOLAPI_PAYMENT_NOTIFICATIONS_ENABLED !== "true") return false;
  const apiKey = process.env.SOLAPI_API_KEY?.trim();
  const apiSecret = process.env.SOLAPI_API_SECRET?.trim();
  const pfId = process.env.SOLAPI_PF_ID?.trim();
  if (!apiKey || !apiSecret || !pfId) {
    console.error("Payment notification configuration is incomplete.");
    return false;
  }
  try {
    const admin = getAdminClient();
    const { data, error } = await admin.rpc("claim_payment_notification", { target_order_uid: orderUid ?? null });
    if (error) throw new Error("CLAIM_FAILED");
    const order = (Array.isArray(data) ? data[0] : null) as PaymentMessageOrder | null;
    if (!order) return false;

    await deliverPaymentMessage(order, {
      async prepare(order) {
        const { data, error } = await admin.auth.admin.getUserById(order.user_id);
        if (error || !data.user) throw new Error("RECIPIENT_UNAVAILABLE");
        const to = readAuthUserMobileNumber(data.user);
        if (!to) throw new Error("RECIPIENT_UNAVAILABLE");
        return { to, ...buildPaymentMessage(order, readAuthUserDisplayName(data.user)) };
      },
      async beginSend(order, templateId) {
        const { data, error } = await admin.rpc("begin_payment_notification_send", {
          target_order_id: order.order_id,
          target_attempt_id: order.attempt_id,
          target_template_id: templateId,
        });
        if (error) throw new Error("SEND_TRANSITION_FAILED");
        return data === true;
      },
      send: (message, order) => sendPaymentMessageOnce({ apiKey, apiSecret, pfId }, { ...message, orderId: order.order_uid }),
      async finish(order, outcome) {
        const { data, error } = await admin.from("payment_notifications").update({
          status: outcome.status,
          error_code: outcome.code,
          provider_message_id: outcome.messageId ?? null,
          provider_group_id: outcome.groupId ?? null,
          next_attempt_at: new Date(Date.now() + 30 * 60_000).toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("order_id", order.order_id).eq("attempt_id", order.attempt_id)
          .in("status", ["preparing", "sending"]).select("order_id");
        if (error || data?.length !== 1) throw new Error("RESULT_PERSIST_FAILED");
      },
      isDefiniteRejection: (error) => error instanceof PaymentMessageRejected,
      log: (code, id) => console.error("Payment notification:", code, id),
    });
    return true;
  } catch {
    console.error("Payment notification dispatch failed.");
    return false;
  }
}

/** 기존 일일 Cron에서 미접수 작업만 최대 10건 처리한다. 불확실한 sending/unknown은 재발송하지 않는다. */
export async function retryPendingPaymentNotifications() {
  let processed = 0;
  for (; processed < 10; processed += 1) {
    if (!(await dispatchPaymentNotification())) break;
  }
  return processed;
}
