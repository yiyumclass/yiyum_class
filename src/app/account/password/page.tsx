import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AccountHeader from "@/components/account/AccountHeader";
import PasswordUpdateForm from "@/components/account/PasswordUpdateForm";
import SiteFooter from "@/components/layout/SiteFooter";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "비밀번호 변경 | 이윰 클래스",
  description: "이윰 클래스 이메일 계정의 비밀번호를 변경합니다.",
  robots: { index: false, follow: false },
};

export default async function AccountPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 메일 발송 경로를 두지 않으므로, 비밀번호 변경은 로그인 상태에서만 가능하다.
  if (!user) {
    redirect("/login?next=/account/password");
  }

  const hasEmailIdentity = (user.identities ?? []).some(
    (identity) => identity.provider === "email"
  );
  const metadata = user.user_metadata ?? {};
  const displayName =
    typeof metadata.nickname === "string" && metadata.nickname.trim()
      ? metadata.nickname.trim()
      : typeof metadata.name === "string" && metadata.name.trim()
        ? metadata.name.trim()
        : user.email ?? "회원";

  return (
    <>
      <AccountHeader active="settings" displayName={displayName} />
      <main style={{ maxWidth: 520, margin: "0 auto", padding: "40px 20px 64px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>
          비밀번호 변경
        </h1>
        <p style={{ color: "#938B7F", fontSize: 14, margin: "0 0 26px", lineHeight: 1.6 }}>
          {hasEmailIdentity
            ? "새 비밀번호를 입력하면 즉시 적용됩니다."
            : "카카오로 가입한 계정입니다. 비밀번호를 설정하면 이메일로도 로그인할 수 있어요."}
        </p>

        <PasswordUpdateForm />

        <p style={{ marginTop: 22, fontSize: 13 }}>
          <Link href="/account/settings" style={{ color: "#B85C38", fontWeight: 600 }}>
            계정 설정으로 돌아가기
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
