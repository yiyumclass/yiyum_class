"use client";

import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import Link from "next/link";
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
  const [policyAccepted, setPolicyAccepted] = useState(false);

  async function requestPayment() {
    if (pending) return;
    setPending(true);
    setMessage("");

    try {
      const result = await createPaymentOrderAction(productSlug, policyAccepted);
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
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          marginBottom: 16,
          padding: "13px 14px",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 10,
          background: "rgba(255,255,255,0.04)",
          color: "#B7A995",
          fontSize: 12,
          lineHeight: 1.65,
          textAlign: "left",
          cursor: pending ? "wait" : "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={policyAccepted}
          onChange={(event) => setPolicyAccepted(event.target.checked)}
          disabled={pending}
          style={{ width: 17, height: 17, margin: "2px 0 0", flex: "0 0 auto" }}
        />
        <span>
          <Link
            href="/terms#refund-policy"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#E9B48E", textDecoration: "underline" }}
          >
            청약철회·환불 기준
          </Link>
          을 확인했으며, 결제 완료 즉시 디지털 콘텐츠 제공이 시작되는 것에 동의합니다.
        </span>
      </label>
      <button
        type="button"
        onClick={requestPayment}
        disabled={pending || !policyAccepted}
        style={{
          width: "100%",
          height: 54,
          borderRadius: 100,
          border: "none",
          background: "#D9825E",
          color: "#1B1815",
          fontSize: 16,
          fontWeight: 700,
          cursor: pending ? "wait" : policyAccepted ? "pointer" : "not-allowed",
          opacity: pending || !policyAccepted ? 0.58 : 1,
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
