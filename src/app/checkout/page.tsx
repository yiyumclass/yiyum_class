import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import FreeEnrollmentForm from "@/components/checkout/FreeEnrollmentForm";
import SiteFooter from "@/components/layout/SiteFooter";
import { hasActiveProductEntitlement } from "@/lib/store/entitlements";
import { loadPublicCourseBySlug } from "@/lib/store/public-course-catalog";
import { loadPublicProductBySlug } from "@/lib/store/public-products";
import { createClient } from "@/lib/supabase/server";

// 결제(수강 신청) 페이지 — 로그인 게이트.
// 미로그인이면 /login 으로 보내고, 로그인 후 여기로 돌아온다(next=/checkout).
// 실제 결제(토스/카카오페이) 연동은 별도 워크스트림으로 이어붙일 자리.
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const nextPath = `/checkout?product=${encodeURIComponent(productSlug)}`;
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const product = await loadPublicProductBySlug(productSlug);
  if (!product) notFound();
  const courseItem =
    product.productType === "course"
      ? await loadPublicCourseBySlug(productSlug)
      : null;
  const alreadyEnrolled = await hasActiveProductEntitlement(supabase, productSlug);

  const meta = user.user_metadata ?? {};
  const displayName = meta.name ?? meta.full_name ?? user.email ?? "회원";
  const lessons = courseItem?.course.sections.flatMap((section) => section.lessons) ?? [];
  const productDescription = courseItem
    ? `${courseItem.course.sections.length}개 챕터 · 총 ${lessons.length}강 · ${courseItem.accessLabel}`
    : `${product.summary} · ${product.accessLabel}`;

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
          결제 연동 전 무료 테스트 운영
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
        ) : (
          <FreeEnrollmentForm productSlug={product.slug} />
        )}
        <p style={{ fontSize: 12, color: "#7C7367", lineHeight: 1.7, margin: "16px 0 0" }}>
          현재는 결제 없이 즉시 이용권이 발급됩니다.
          <br />
          신청 완료 후 마이 클래스에서 바로 확인할 수 있어요.
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
