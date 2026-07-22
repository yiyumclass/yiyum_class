import type { Metadata } from "next";
import Link from "next/link";
import TossPaymentFailure from "@/components/checkout/TossPaymentFailure";

export const metadata: Metadata = {
  title: "결제 실패 | 이윰 클래스",
  robots: { index: false },
};

export default async function CheckoutFailPage({
  searchParams,
}: {
  searchParams: Promise<{
    code?: string | string[];
    orderId?: string | string[];
    product?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const code = first(query.code);
  const orderId = first(query.orderId);
  const productSlug = safeProductSlug(first(query.product));

  return (
    <main style={pageStyle}>
      <TossPaymentFailure orderId={orderId} />
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
          결제가 완료되지 않았습니다
        </h1>
        <p style={{ color: "#B7A995", fontSize: 14, lineHeight: 1.8, margin: "0 0 30px" }}>
          {failureMessage(code)}
        </p>
        <Link
          href={`/checkout?product=${encodeURIComponent(productSlug)}`}
          style={primaryLinkStyle}
        >
          다시 결제하기
        </Link>
      </div>
    </main>
  );
}

const pageStyle = {
  minHeight: "100dvh",
  background: "#1B1815",
  color: "#EDE7DC",
  display: "grid",
  placeItems: "center",
  padding: "40px 24px",
} as const;

const primaryLinkStyle = {
  width: "100%",
  height: 54,
  borderRadius: 100,
  background: "#D9825E",
  color: "#1B1815",
  fontSize: 16,
  fontWeight: 700,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
} as const;

function failureMessage(code: string) {
  if (code === "PAY_PROCESS_CANCELED" || code === "USER_CANCEL") {
    return "결제를 취소했습니다. 결제를 원하시면 다시 시도해 주세요.";
  }
  if (code === "PAY_PROCESS_ABORTED") {
    return "결제 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  }
  return "카드 승인 또는 결제 인증에 실패했습니다. 다른 결제수단으로 다시 시도해 주세요.";
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function safeProductSlug(value: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : "sns-monetization";
}
