import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AuthForm from "@/components/auth/AuthForm";
import SiteFooter from "@/components/layout/SiteFooter";
import { normalizeInternalNext, readFirstParam } from "@/lib/auth/redirects";
import { hasActiveAccount } from "@/lib/supabase/account-status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "로그인 | 이윰 클래스",
  description: "이윰 클래스 계정으로 로그인하고 수강 중인 강의를 이어서 학습하세요.",
  robots: { index: false },
};

type AuthSearchParams = Promise<{
  next?: string | string[];
  error?: string | string[];
  withdrawn?: string | string[];
}>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: AuthSearchParams;
}) {
  const query = await searchParams;
  const nextPath = normalizeInternalNext(readFirstParam(query.next));
  const authErrorCode = readFirstParam(query.error);
  const authError =
    authErrorCode === "auth"
      ? "카카오 로그인 연결을 완료하지 못했습니다. 다시 시도해 주세요."
      : authErrorCode === "auth_unavailable"
        ? "가입 정보를 확인하는 중 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요."
        : null;
  const authNotice = readFirstParam(query.withdrawn) === "1"
    ? "회원 탈퇴가 완료되었습니다. 그동안 이용해 주셔서 감사합니다."
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
        mode="login"
        nextPath={nextPath}
        authError={authError}
        authNotice={authNotice}
      />
      <SiteFooter variant="compact" />
    </>
  );
}
