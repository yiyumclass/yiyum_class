import type { Metadata } from "next";
import Link from "next/link";
import TossPaymentConfirmation from "@/components/checkout/TossPaymentConfirmation";

export const metadata: Metadata = {
  title: "결제 확인 | 이윰 클래스",
  robots: { index: false },
};

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{
    paymentKey?: string | string[];
    orderId?: string | string[];
    amount?: string | string[];
    product?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const paymentKey = first(query.paymentKey);
  const orderId = first(query.orderId);
  const amount = Number(first(query.amount));
  const productSlug = safeProductSlug(first(query.product));
  const valid =
    paymentKey.length >= 1 &&
    paymentKey.length <= 200 &&
    /^[A-Za-z0-9_-]{6,64}$/.test(orderId) &&
    Number.isInteger(amount) &&
    amount > 0;

  return (
    <main style={pageStyle}>
      {valid ? (
        <TossPaymentConfirmation
          paymentKey={paymentKey}
          orderId={orderId}
          amount={amount}
          productSlug={productSlug}
        />
      ) : (
        <div style={{ width: "100%", maxWidth: 460, textAlign: "center" }}>
          <h1 className="serif" style={{ fontSize: 30, margin: "0 0 14px" }}>
            결제 정보를 확인하지 못했습니다
          </h1>
          <p style={{ color: "#B7A995", fontSize: 14, lineHeight: 1.8 }}>
            결제 페이지에서 다시 시도해 주세요.
          </p>
          <Link
            href={`/checkout?product=${encodeURIComponent(productSlug)}`}
            style={{ color: "#D9825E", fontSize: 14 }}
          >
            결제 페이지로 돌아가기
          </Link>
        </div>
      )}
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

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function safeProductSlug(value: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : "sns-monetization";
}
