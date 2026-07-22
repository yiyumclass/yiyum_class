import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import FreeEnrollmentForm from "@/components/checkout/FreeEnrollmentForm";
import TossPaymentForm from "@/components/checkout/TossPaymentForm";
import SiteFooter from "@/components/layout/SiteFooter";
import { hasActiveProductEntitlement } from "@/lib/store/entitlements";
import { getPaymentMode, isTossPaymentConfigured } from "@/lib/store/free-enrollment";
import { loadPublicCourseBySlug } from "@/lib/store/public-course-catalog";
import { loadPublicProductBySlug } from "@/lib/store/public-products";
import { getVerifiedIdentity } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "수강 신청 | 이윰 클래스",
  description: "이윰 클래스 수강 신청 페이지입니다.",
  robots: { index: false },
};

// 결제(수강 신청) 페이지 — 로그인 게이트.
// 미로그인이면 /login 으로 보내고, 로그인 후 여기로 돌아온다(next=/checkout).
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string | string[] }>;
}) {
  const query = await searchParams;
  const requestedProduct = Array.isArray(query.product)
    ? query.product[0]
    : query.product;
  const productSlug = requestedProduct || "sns-monetization";
  const supabase = await createClient();
  const identity = await getVerifiedIdentity(supabase);

  if (!identity) {
    const nextPath = `/checkout?product=${encodeURIComponent(productSlug)}`;
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const product = await loadPublicProductBySlug(productSlug);
  if (!product) notFound();
  const [courseItem, alreadyEnrolled] = await Promise.all([
    product.productType === "course"
      ? loadPublicCourseBySlug(productSlug)
      : Promise.resolve(null),
    hasActiveProductEntitlement(supabase, productSlug),
  ]);

  const meta = identity.metadata;
  const rawDisplayName = meta.name ?? meta.full_name;
  const displayName =
    typeof rawDisplayName === "string" && rawDisplayName.trim()
      ? rawDisplayName.trim()
      : identity.email ?? "회원";
  const lessons = courseItem?.course.sections.flatMap((section) => section.lessons) ?? [];
  const productDescription = courseItem
    ? `${courseItem.course.sections.length}개 챕터 · 총 ${lessons.length}강 · ${courseItem.accessLabel}`
    : `${product.summary} · ${product.accessLabel}`;
  const paymentMode = getPaymentMode();
  const tossClientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? "";
  const isFreeProduct = product.priceKrw === 0;
  const canRequestTossPayment = isTossPaymentConfigured() && tossClientKey.length > 0;

  return (
    <>
      <main
      style={{
        minHeight: "100dvh",
        background: "#1B1815",
        color: "#EDE7DC",
        display: "grid",
        placeItems: "center",
        padding: "40px 24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 460, textAlign: "center" }}>
        <div
          style={{
            fontSize: 13,
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            color: "#B7A995",
            marginBottom: 24,
          }}
        >
          Checkout
        </div>

        <h1 className="serif" style={{ fontSize: 30, lineHeight: 1.3, margin: "0 0 8px" }}>
          {product.title}
        </h1>
        <p style={{ fontSize: 14, color: "#9A9082", margin: "0 0 32px" }}>
          {productDescription}
        </p>

        <div
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <span className="serif" style={{ fontSize: 52, lineHeight: 1, color: "#EDE7DC" }}>
            {new Intl.NumberFormat("ko-KR").format(product.priceKrw)}
          </span>
          <span className="serif" style={{ fontSize: 22, color: "#D9825E" }}>
            원
          </span>
        </div>
        <div style={{ fontSize: 13, color: "#7C7367", marginBottom: 32 }}>
          {isFreeProduct
            ? "무료 콘텐츠"
            : paymentMode === "free"
              ? "결제 준비 중"
              : paymentMode === "toss_test"
              ? "Toss Payments 테스트 결제 · 실제 청구 없음"
              : "Toss Payments 안전 결제"}
        </div>

        <div
          style={{
            fontSize: 13,
            color: "#B7A995",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 28,
          }}
        >
          <strong style={{ color: "#EDE7DC" }}>{displayName}</strong> 님으로 신청합니다
        </div>

        {alreadyEnrolled ? (
          <Link
            href="/my"
            style={{
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
            }}
          >
            마이 클래스에서 확인하기
          </Link>
        ) : isFreeProduct ? (
          <FreeEnrollmentForm productSlug={product.slug} />
        ) : canRequestTossPayment ? (
          <TossPaymentForm
            productSlug={product.slug}
            clientKey={tossClientKey}
            customerKey={identity.userId}
            customerName={displayName.slice(0, 100)}
            customerEmail={identity.email?.slice(0, 100) ?? null}
            paymentMode={paymentMode === "toss_live" ? "toss_live" : "toss_test"}
          />
        ) : (
          <p role="alert" style={{ color: "#F0A98C", fontSize: 13, lineHeight: 1.6 }}>
            결제 설정을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.
          </p>
        )}
        <p style={{ fontSize: 12, color: "#7C7367", lineHeight: 1.7, margin: "16px 0 0" }}>
          {isFreeProduct ? (
            <>신청 완료 후 마이 클래스에서 바로 확인할 수 있어요.</>
          ) : (
            <>
              결제가 승인되면 이용권이 자동으로 발급됩니다.
              <br />
              {paymentMode === "toss_test"
                ? "테스트 키 결제는 실제 카드에 청구되지 않습니다."
                : "결제 정보는 Toss Payments에서 안전하게 처리됩니다."}
            </>
          )}
        </p>

        <div style={{ marginTop: 36, fontSize: 13 }}>
          <Link href={courseItem?.detailHref ?? product.detailHref} style={{ color: "#9A9082" }}>
            ← 상세로 돌아가기
          </Link>
          <span style={{ color: "#4A443D", margin: "0 12px" }}>·</span>
          <Link href="/my" style={{ color: "#9A9082" }}>
            마이 클래스
          </Link>
        </div>
      </div>
      </main>
      <SiteFooter variant="compact" tone="dark" />
    </>
  );
}
