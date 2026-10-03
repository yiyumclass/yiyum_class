import type { TossPaymentsWidgets } from "@tosspayments/tosspayments-sdk";

type PaymentWindowRequest = {
  orderId: string;
  orderName: string;
  customerName: string;
  customerEmail: string | null;
  successUrl: string;
  failUrl: string;
  metadata: Record<string, string>;
};

export function isPaymentWindowKeyPair(clientKey: string, secretKey: string, mode: string) {
  const prefix = mode === "toss_test" ? "test" : mode === "toss_live" ? "live" : null;
  return prefix !== null && clientKey.startsWith(`${prefix}_gck_`) &&
    secretKey.startsWith(`${prefix}_gsk_`) &&
    clientKey.length > `${prefix}_gck_`.length && secretKey.length > `${prefix}_gsk_`.length;
}

export function paymentWindowCanceled() {
  return Object.assign(new Error("결제를 취소했습니다."), { code: "USER_CANCEL" });
}

export function isPaymentCanceled(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "USER_CANCEL" || error.code === "PAY_PROCESS_CANCELED");
}

export async function requestTossPaymentWindow({
  widgets,
  amount,
  variantKey,
  request,
  signal,
}: {
  widgets: Pick<TossPaymentsWidgets, "setAmount" | "renderPaymentWindow" | "requestPayment">;
  amount: number;
  variantKey: string;
  request: PaymentWindowRequest;
  signal: AbortSignal;
}) {
  if (!variantKey.trim() || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Invalid payment window configuration");
  }
  if (signal.aborted) throw paymentWindowCanceled();
  await widgets.setAmount({ currency: "KRW", value: amount });
  if (signal.aborted) throw paymentWindowCanceled();
  const paymentWindow = await widgets.renderPaymentWindow({
    orderName: request.orderName,
    variantKey: { paymentMethod: variantKey },
  });
  let onAbort: (() => void) | undefined;

  try {
    if (signal.aborted) throw paymentWindowCanceled();
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let submitting = false;
      function finish(error?: unknown) {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      }

      onAbort = () => finish(paymentWindowCanceled());
      signal.addEventListener("abort", onAbort, { once: true });
      paymentWindow.on("cancel", async () => {
        if (!submitting) finish(paymentWindowCanceled());
      });
      paymentWindow.on("paymentRequest", async ({ paymentMethod }) => {
        if (settled || submitting) return;
        if (paymentMethod.code !== "CARD") {
          finish(Object.assign(new Error("Card payment only"), { code: "CARD_ONLY" }));
          return;
        }
        submitting = true;
        try {
          await widgets.requestPayment(request);
          finish();
        } catch (error) {
          finish(error);
        }
      });
    });
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    await paymentWindow.destroy().catch(() => undefined);
  }
}
