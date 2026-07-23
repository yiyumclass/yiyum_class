import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AuthForm from "@/components/auth/AuthForm";
import SiteFooter from "@/components/layout/SiteFooter";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "회원가입 | 이윰 클래스",
  description: "이윰 클래스에 가입하고 SNS 수익화 VOD 클래스를 수강하세요.",
  robots: { index: false },
};

type AuthSearchParams = Promise<{
  next?: string | string[];
}>;

export default async function SignupPage({
  searchParams,
}: {
  searchParams: AuthSearchParams;
}) {
  const query = await searchParams;
  const nextPath = normalizeInternalNext(readFirstParam(query.next));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(nextPath);
  }

  return (
    <>
      <AuthForm mode="signup" nextPath={nextPath} authError={null} />
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
