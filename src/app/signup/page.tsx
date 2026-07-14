import AuthForm from "@/components/auth/AuthForm";
import SiteFooter from "@/components/layout/SiteFooter";

export default function SignupPage() {
  return (
    <>
      <AuthForm mode="signup" />
      <SiteFooter variant="compact" />
    </>
  );
}
