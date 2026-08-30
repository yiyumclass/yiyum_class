import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AuthForm from "@/components/auth/AuthForm";
import SiteFooter from "@/components/layout/SiteFooter";
import { normalizeInternalNext, readFirstParam } from "@/lib/auth/redirects";
import { hasActiveAccount } from "@/lib/supabase/account-status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "회원가입 | 이윰 클래스",
  description: "이윰 클래스에 가입하고 SNS 수익화 VOD 클래스를 수강하세요.",
  robots: { index: false },
};

type AuthSearchParams = Promise<{
  next?: string | string[];
  error?: string | string[];
}>;

export default async function SignupPage({
  searchParams,
}: {
  searchParams: AuthSearchParams;
}) {
  const query = await searchParams;
  const nextPath = normalizeInternalNext(readFirstParam(query.next));
  const authError = readFirstParam(query.error) === "consent"
    ? "회원가입을 계속하려면 필수 항목에 동의해 주세요."
    : null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(
      (await hasActiveAccount(supabase)) ? nextPath : "/account/settings"
    );
  }

  return (
    <>
      <AuthForm
        mode="signup"
        nextPath={nextPath}
        authError={authError}
        authNotice={null}
      />
      <SiteFooter variant="compact" />
    </>
  );
}
