"use client";

import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPaymentOrderAction, markPaymentOrderFailedAction } from "@/app/checkout/actions";
import type { ProductType } from "@/lib/store/product-type";
import {
  isPaymentCanceled,
  paymentWindowCanceled,
  requestTossPaymentWindow,
} from "@/lib/payments/payment-window";

type TossPaymentFormProps = {
  productSlug: string;
  clientKey: string;
  customerKey: string;
  customerName: string;
  customerEmail: string | null;
  paymentMode: "toss_test" | "toss_live";
  productType: ProductType;
  amount: number;
  variantKey: string;
};

export default function TossPaymentForm({
  productSlug,
  clientKey,
  customerKey,
  customerName,
  customerEmail,
  paymentMode,
  productType,
  amount,
  variantKey,
}: TossPaymentFormProps) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const inFlight = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => () => activeRequest.current?.abort(), []);

  async function requestPayment() {
    if (inFlight.current || !policyAccepted) return;
    inFlight.current = true;
    const controller = new AbortController();
    activeRequest.current = controller;
    setPending(true);
    setMessage("");
    let orderId: string | null = null;

    try {
      const result = await createPaymentOrderAction(productSlug, policyAccepted);
      if (!result.ok) {
        if (!controller.signal.aborted) setMessage(result.message);
        return;
      }
      orderId = result.order.orderId;
      if (controller.signal.aborted) throw paymentWindowCanceled();
      if (result.order.amount !== amount) {
        setMessage("결제 금액이 변경되었습니다. 새로고침 후 금액을 확인해 주세요.");
        await markPaymentOrderFailedAction(orderId).catch(() => undefined);
        return;
      }
      const tossPayments = await loadTossPayments(clientKey);
      const widgets = tossPayments.widgets({ customerKey });
      const origin = window.location.origin;

      await requestTossPaymentWindow({
        widgets,
        amount: result.order.amount,
        variantKey,
        signal: controller.signal,
        request: {
          orderId: result.order.orderId,
          orderName: result.order.orderName,
          customerName,
          customerEmail,
          successUrl: `${origin}/checkout/success?product=${encodeURIComponent(productSlug)}`,
          failUrl: `${origin}/checkout/fail?product=${encodeURIComponent(productSlug)}&orderId=${encodeURIComponent(orderId)}`,
          metadata: {
            productSlug: result.order.productSlug,
          },
        },
      });
    } catch (error) {
      if (!controller.signal.aborted) setMessage(resolvePaymentError(error));
      if (orderId && isPaymentCanceled(error) && !controller.signal.aborted) {
        await markPaymentOrderFailedAction(orderId).catch(() => undefined);
      }
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setPending(false);
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }

  return (
    <div>
      <p style={{ color: "#B7A995", fontSize: 13, lineHeight: 1.7, margin: "0 0 20px" }}>
        카드사와 할부는 다음 토스 결제창에서 선택합니다.
        <br />할부 가능 여부와 무이자 혜택은 카드사·카드 종류에 따라 다릅니다.
      </p>
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
          을 확인했으며, {formatFulfillmentConsent(productType)}
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
          ? "토스 결제창 진행 중..."
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

function formatFulfillmentConsent(productType: ProductType) {
  if (productType === "consulting") {
    return "결제 완료 후 상담 안내와 일정 조율이 시작되는 것에 동의합니다.";
  }
  if (productType === "ebook") {
    return "결제 완료 즉시 자료 이용 권한이 제공되고 최초 열람·다운로드 시 이용이 개시되는 것에 동의합니다.";
  }
  return "결제 완료 즉시 VOD 이용 권한이 제공되고 유료 강의 최초 재생 시 디지털 콘텐츠 이용이 개시되는 것에 동의합니다.";
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
    return "토스 결제창형 연동 키 설정을 확인해 주세요.";
  }
  if (code === "CARD_ONLY") {
    return "현재 신용·체크카드 결제만 가능합니다. 카드를 선택해 다시 시도해 주세요.";
  }
  if (code === "INVALID_VARIANT_KEY" || code === "NOT_REGISTERED_PAYMENT_WIDGET") {
    return "토스 결제 UI 설정을 확인하고 있습니다. 운영자에게 문의해 주세요.";
  }

  return "결제창을 열지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
