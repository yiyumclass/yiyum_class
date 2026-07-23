import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AuthForm from "@/components/auth/AuthForm";
import SiteFooter from "@/components/layout/SiteFooter";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "로그인 | 이윰 클래스",
  description: "이윰 클래스 계정으로 로그인하고 수강 중인 강의를 이어서 학습하세요.",
  robots: { index: false },
};

type AuthSearchParams = Promise<{
  next?: string | string[];
  error?: string | string[];
}>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: AuthSearchParams;
}) {
  const query = await searchParams;
  const nextPath = normalizeInternalNext(readFirstParam(query.next));
  const authError = readFirstParam(query.error) === "auth"
    ? "카카오 로그인 연결을 완료하지 못했습니다. 다시 시도해 주세요."
    : null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(nextPath);
  }

  return (
    <>
      <AuthForm mode="login" nextPath={nextPath} authError={authError} />
      <SiteFooter variant="compact" />
    </>
  );
}

function readFirstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeInternalNext(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }

  const pathname = value.split(/[?#]/, 1)[0]?.replace(/\/+$/, "") || "/";
  if (pathname === "/login" || pathname === "/signup" || pathname === "/auth/callback") {
    return "/";
  }

  return value;
}
