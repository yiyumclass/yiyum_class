"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hasActiveAdminAccess } from "@/lib/admin/access";
import { normalizeInternalNext } from "@/lib/auth/redirects";
import { recordSecurityAccessEvent } from "@/lib/security/access-log";
import { createClient } from "@/lib/supabase/server";
import { hasActiveAccount } from "@/lib/supabase/account-status";

export type EmailLoginResult = {
  message: string | null;
};

/** 기존 관리자·이메일 회원 로그인을 서버에서 처리해 접속기록과 세션 쿠키를 함께 남긴다. */
export async function loginWithEmailAction(
  _previousState: EmailLoginResult,
  formData: FormData
): Promise<EmailLoginResult> {
  const rawEmail = formData.get("email");
  const rawPassword = formData.get("password");
  const rawNextPath = formData.get("nextPath");
  const email = typeof rawEmail === "string"
    ? rawEmail.trim().toLowerCase()
    : "";
  const password = typeof rawPassword === "string" ? rawPassword : "";
  const nextPath = normalizeInternalNext(
    typeof rawNextPath === "string" && rawNextPath.length <= 2048
      ? rawNextPath
      : "/"
  );

  if (!isValidEmail(email)) {
    return { message: "이메일 주소를 확인해 주세요." };
  }
  if (password.length < 6 || password.length > 512) {
    return { message: "비밀번호는 6자 이상이어야 해요." };
  }

  const requestHeaders = await headers();
  const supabase = await createClient();
  const authResult = await supabase.auth.signInWithPassword({ email, password })
    .catch(() => null);
  if (!authResult) {
    return { message: "로그인 연결에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }
  const { data, error } = authResult;

  if (error || !data.user) {
    await recordSecurityAccessEvent({
      provider: "email",
      outcome: "failure",
      subject: email,
      failureCode: classifyEmailLoginFailure(error),
      headers: requestHeaders,
    });
    return {
      message: translateEmailLoginFailure(error),
    };
  }

  if (!(await hasActiveAccount(supabase))) {
    await recordSecurityAccessEvent({
      provider: "email", outcome: "blocked", subject: data.user.id,
      failureCode: "account_inactive", headers: requestHeaders,
    });
    redirect("/account/settings");
  }
  const isAdmin = await hasActiveAdminAccess(supabase, data.user.id);
  await recordSecurityAccessEvent({
    provider: "email",
    outcome: "success",
    subject: data.user.id,
    headers: requestHeaders,
  });

  redirect(isAdmin ? "/admin" : nextPath);
}

function isValidEmail(email: string) {
  return email.length >= 5 && email.length <= 254 && email.includes("@");
}

type AuthFailure = {
  code?: string;
  message?: string;
  status?: number;
} | null;

function classifyEmailLoginFailure(error: AuthFailure) {
  const code = error?.code?.toLowerCase();
  const message = error?.message?.toLowerCase() ?? "";

  if (error?.status === 429 || code?.includes("rate")) return "rate_limited";
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "email_not_confirmed";
  }
  return "invalid_credentials";
}

function translateEmailLoginFailure(error: AuthFailure) {
  const message = error?.message?.toLowerCase() ?? "";
  if (error?.status === 429 || error?.code?.toLowerCase().includes("rate")) {
    return "로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (message.includes("email not confirmed")) {
    return "이메일 인증이 필요해요. 받은 메일의 링크를 눌러 주세요.";
  }
  return "이메일 또는 비밀번호가 올바르지 않습니다.";
}
