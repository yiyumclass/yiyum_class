"use client";

import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import { useState } from "react";
import { createPaymentOrderAction } from "@/app/checkout/actions";

type TossPaymentFormProps = {
  productSlug: string;
  clientKey: string;
  customerKey: string;
  customerName: string;
  customerEmail: string | null;
  paymentMode: "toss_test" | "toss_live";
};

export default function TossPaymentForm({
  productSlug,
  clientKey,
  customerKey,
  customerName,
  customerEmail,
  paymentMode,
}: TossPaymentFormProps) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function requestPayment() {
    if (pending) return;
    setPending(true);
    setMessage("");

    try {
      const result = await createPaymentOrderAction(productSlug);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      const tossPayments = await loadTossPayments(clientKey);
      const payment = tossPayments.payment({ customerKey });
      const origin = window.location.origin;

      await payment.requestPayment({
        method: "CARD",
        amount: {
          currency: "KRW",
          value: result.order.amount,
        },
        orderId: result.order.orderId,
        orderName: result.order.orderName,
        customerName,
        customerEmail,
        successUrl: `${origin}/checkout/success?product=${encodeURIComponent(productSlug)}`,
        failUrl: `${origin}/checkout/fail?product=${encodeURIComponent(productSlug)}`,
        card: {
          flowMode: "DEFAULT",
          useEscrow: false,
        },
        metadata: {
          productSlug: result.order.productSlug,
        },
      });
    } catch (error) {
      setMessage(resolvePaymentError(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={requestPayment}
        disabled={pending}
        style={{
          width: "100%",
          height: 54,
          borderRadius: 100,
          border: "none",
          background: "#D9825E",
          color: "#1B1815",
          fontSize: 16,
          fontWeight: 700,
          cursor: pending ? "wait" : "pointer",
          opacity: pending ? 0.7 : 1,
        }}
      >
        {pending
          ? "결제창 준비 중..."
          : paymentMode === "toss_test"
            ? "테스트 결제하기"
            : "결제하기"}
      </button>
      {message && (
        <p
          role="alert"
          style={{ color: "#F0A98C", fontSize: 13, lineHeight: 1.6, margin: "14px 0 0" }}
        >
          {message}
        </p>
      )}
    </div>
  );
}

function resolvePaymentError(error: unknown) {
  if (!error || typeof error !== "object") {
    return "결제창을 열지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }

  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  if (code === "USER_CANCEL" || code === "PAY_PROCESS_CANCELED") {
    return "결제를 취소했습니다. 결제를 원하시면 다시 시도해 주세요.";
  }
  if (code === "INVALID_CLIENT_KEY" || code === "UNAUTHORIZED_KEY") {
    return "결제 테스트 키 설정을 확인해 주세요.";
  }

  return "결제창을 열지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
