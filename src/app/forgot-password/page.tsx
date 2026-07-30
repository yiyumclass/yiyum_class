import type { Metadata } from "next";
import Link from "next/link";
import PasswordResetRequestForm from "@/components/auth/PasswordResetRequestForm";
import SiteFooter from "@/components/layout/SiteFooter";

export const metadata: Metadata = {
  title: "비밀번호 재설정 | 이윰 클래스",
  description: "이윰 클래스 이메일 계정의 비밀번호를 재설정합니다.",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <>
      <main
        style={{
          minHeight: "70vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "56px 20px",
        }}
      >
        <div style={{ width: "100%", maxWidth: 380, textAlign: "center" }}>
          <Link
            href="/"
            className="serif"
            style={{
              display: "inline-block",
              marginBottom: 22,
              color: "#201C17",
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            이윰
          </Link>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 6px" }}>
            비밀번호 재설정
          </h1>
          <p style={{ color: "#938B7F", fontSize: 14, margin: "0 0 26px" }}>
            가입한 이메일로 재설정 링크를 보내드려요
          </p>

          <PasswordResetRequestForm />

          <p style={{ marginTop: 20, fontSize: 13, color: "#938B7F" }}>
            <Link href="/login" style={{ color: "#B85C38", fontWeight: 600 }}>
              로그인으로 돌아가기
            </Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
