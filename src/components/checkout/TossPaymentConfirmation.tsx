"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type ConfirmationState =
  | { status: "confirming"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string; retryable: boolean };

export default function TossPaymentConfirmation({
  paymentKey,
  orderId,
  amount,
  productSlug,
}: {
  paymentKey: string;
  orderId: string;
  amount: number;
  productSlug: string;
}) {
  const started = useRef(false);
  const [state, setState] = useState<ConfirmationState>({
    status: "confirming",
    message: "결제 승인을 확인하고 있습니다.",
  });

  const confirm = useCallback(async () => {
    setState({ status: "confirming", message: "결제 승인을 확인하고 있습니다." });
    try {
      const response = await fetch("/api/payments/toss/confirm", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentKey, orderId, amount }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const message = readMessage(payload);

      if (!response.ok) {
        setState({
          status: "error",
          message: message ?? "결제 승인을 확인하지 못했습니다.",
          retryable: readRetryable(payload),
        });
        return;
      }

      setState({
        status: "success",
        message: "결제가 완료되고 이용권이 발급되었습니다.",
      });
    } catch {
      setState({
        status: "error",
        message: "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
        retryable: true,
      });
    }
  }, [amount, orderId, paymentKey]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void confirm();
  }, [confirm]);

  return (
    <div style={{ width: "100%", maxWidth: 460, textAlign: "center" }}>
      <p
        style={{
          fontSize: 13,
          letterSpacing: "0.24em",
          textTransform: "uppercase",
          color: "#B7A995",
          margin: "0 0 22px",
        }}
      >
        Payment Result
      </p>
      <h1 className="serif" style={{ fontSize: 30, margin: "0 0 14px" }}>
        {state.status === "success"
          ? "결제가 완료되었습니다"
          : state.status === "error"
            ? "결제를 확인해 주세요"
            : "결제를 확인하고 있습니다"}
      </h1>
      <p
        role="status"
        style={{
          color: state.status === "error" ? "#F0A98C" : "#B7A995",
          fontSize: 14,
          lineHeight: 1.8,
          margin: "0 0 30px",
        }}
      >
        {state.message}
      </p>

      {state.status === "confirming" && (
        <span aria-hidden="true" style={{ color: "#D9825E", fontSize: 28 }}>
          ···
        </span>
      )}
      {state.status === "success" && (
        <Link href="/my" style={primaryLinkStyle}>
          마이 클래스에서 시작하기
        </Link>
      )}
      {state.status === "error" && (
        <div style={{ display: "grid", gap: 12 }}>
          {state.retryable && (
            <button type="button" onClick={confirm} style={primaryButtonStyle}>
              다시 확인하기
            </button>
          )}
          <Link
            href={`/checkout?product=${encodeURIComponent(productSlug)}`}
            style={{ color: "#B7A995", fontSize: 13 }}
          >
            결제 페이지로 돌아가기
          </Link>
        </div>
      )}
    </div>
  );
}

const primaryButtonStyle = {
  width: "100%",
  height: 54,
  borderRadius: 100,
  border: "none",
  background: "#D9825E",
  color: "#1B1815",
  fontSize: 16,
  fontWeight: 700,
  cursor: "pointer",
} as const;

const primaryLinkStyle = {
  ...primaryButtonStyle,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
} as const;

function readMessage(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const message = (payload as Record<string, unknown>).message;
  return typeof message === "string" ? message : null;
}

function readRetryable(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return (payload as Record<string, unknown>).retryable === true;
}
