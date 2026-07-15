import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AccountHeader from "@/components/account/AccountHeader";
import AccountSettings from "@/components/account/AccountSettings";
import SiteFooter from "@/components/layout/SiteFooter";
import { createClient } from "@/lib/supabase/server";
import styles from "./settings.module.css";

export const metadata: Metadata = {
  title: "계정 설정 | 이윰 클래스",
  description: "프로필, 연결 계정과 알림 설정을 확인하세요.",
  robots: { index: false, follow: false },
};

export default async function AccountSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/account/settings");
  }

  const metadata = user.user_metadata ?? {};
  const name = readMetadataValue(metadata.name) || "회원";
  const nickname =
    readMetadataValue(metadata.nickname) ||
    readMetadataValue(metadata.full_name) ||
    name;
  const phone = readMetadataValue(metadata.phone);

  return (
    <div className={styles.page}>
      <AccountHeader active="settings" displayName={nickname} />
      <main className={styles.main}>
        <AccountSettings
          profile={{
            name,
            nickname,
            email: user.email ?? "카카오에서 이메일 제공 동의 후 표시됩니다",
            phone,
            joinedAt: formatJoinedAt(user.created_at),
            marketingEnabled: metadata.marketing_opt_in === true,
          }}
        />
      </main>
      <SiteFooter variant="compact" />
    </div>
  );
}

function readMetadataValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function formatJoinedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}
