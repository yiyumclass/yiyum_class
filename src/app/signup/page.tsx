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
  notice?: string | string[];
}>;

export default async function SignupPage({
  searchParams,
}: {
  searchParams: AuthSearchParams;
}) {
  const query = await searchParams;
  const nextPath = normalizeInternalNext(readFirstParam(query.next));
  const authErrorCode = readFirstParam(query.error);
  const authNoticeCode = readFirstParam(query.notice);
  const authError =
    authErrorCode === "auth_unavailable"
      ? "가입 정보를 확인하는 중 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요."
      : null;
  const authNotice =
    authNoticeCode === "signup_required" || authErrorCode === "consent"
      ? "카카오 회원가입이 아직 완료되지 않았어요. 필수 항목에 동의한 뒤 카카오로 시작해 주세요."
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
        authNotice={authNotice}
      />
      <SiteFooter variant="compact" />
    </>
  );
}
