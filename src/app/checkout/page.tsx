import Link from "next/link";
import { redirect } from "next/navigation";
import SiteFooter from "@/components/layout/SiteFooter";
import { createClient } from "@/lib/supabase/server";

// 결제(수강 신청) 페이지 — 로그인 게이트.
// 미로그인이면 /login 으로 보내고, 로그인 후 여기로 돌아온다(next=/checkout).
// 실제 결제(토스/카카오페이) 연동은 별도 워크스트림으로 이어붙일 자리.
export default async function CheckoutPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/checkout");
  }

  const meta = user.user_metadata ?? {};
  const displayName = meta.name ?? meta.full_name ?? user.email ?? "회원";

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
          이윰 SNS 수익화 클래스
        </h1>
        <p style={{ fontSize: 14, color: "#9A9082", margin: "0 0 32px" }}>
          5개 챕터 · 총 32강 · 1:1 피드백 · 365일 VOD 소장
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
            300,000
          </span>
          <span className="serif" style={{ fontSize: 22, color: "#D9825E" }}>
            원
          </span>
        </div>
        <div style={{ fontSize: 13, color: "#7C7367", marginBottom: 32 }}>부가세 포함</div>

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

        {/* 결제 연동 전 자리표시자 — 토스/카카오페이 연결 시 이 버튼을 결제 호출로 교체 */}
        <button
          type="button"
          disabled
          style={{
            width: "100%",
            height: 54,
            borderRadius: 100,
            border: "none",
            background: "#D9825E",
            color: "#1B1815",
            fontSize: 16,
            fontWeight: 600,
            opacity: 0.55,
            cursor: "not-allowed",
          }}
        >
          결제하기 (준비 중)
        </button>
        <p style={{ fontSize: 12, color: "#7C7367", lineHeight: 1.7, margin: "16px 0 0" }}>
          결제 수단(토스/카카오페이) 연동을 준비 중이에요.
          <br />
          곧 이 화면에서 바로 결제할 수 있게 됩니다.
        </p>

        <div style={{ marginTop: 36, fontSize: 13 }}>
          <Link href="/" style={{ color: "#9A9082" }}>
            ← 홈으로
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
