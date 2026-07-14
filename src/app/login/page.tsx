import AuthForm from "@/components/auth/AuthForm";
import SiteFooter from "@/components/layout/SiteFooter";

export default function LoginPage() {
  return (
    <>
      <AuthForm mode="login" />
      <SiteFooter variant="compact" />
    </>
  );
}
