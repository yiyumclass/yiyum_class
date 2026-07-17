import type { Metadata } from "next";
import AuthForm from "@/components/auth/AuthForm";
import SiteFooter from "@/components/layout/SiteFooter";

export const metadata: Metadata = {
  title: "로그인 | 이윰 클래스",
  description: "이윰 클래스 계정으로 로그인하고 수강 중인 강의를 이어서 학습하세요.",
  robots: { index: false },
};

export default function LoginPage() {
  return (
    <>
      <AuthForm mode="login" />
      <SiteFooter variant="compact" />
    </>
  );
}
