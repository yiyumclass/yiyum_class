import type { Metadata } from "next";
import AuthForm from "@/components/auth/AuthForm";
import SiteFooter from "@/components/layout/SiteFooter";

export const metadata: Metadata = {
  title: "회원가입 | 이윰 클래스",
  description: "이윰 클래스에 가입하고 SNS 수익화 VOD 클래스를 수강하세요.",
  robots: { index: false },
};

export default function SignupPage() {
  return (
    <>
      <AuthForm mode="signup" />
      <SiteFooter variant="compact" />
    </>
  );
}
