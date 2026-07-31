import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AdminCurrentSection from "@/components/admin/AdminCurrentSection";
import AdminFeedbackProvider from "@/components/admin/AdminFeedback";
import AdminNavigation from "@/components/admin/AdminNavigation";
import { ExternalIcon } from "@/components/admin/icons";
import { requireAdmin, type AdminRole } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import "./admin-tokens.css";
import styles from "./admin.module.css";

export const metadata: Metadata = {
  title: "관리자 | 이윰 클래스",
  description: "이윰 클래스 상품과 회원 운영을 관리합니다.",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const admin = await requireAdmin();

  const signOut = async () => {
    "use server";
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/");
  };

  return (
    <AdminFeedbackProvider>
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <Link href="/admin" className={styles.adminBrand} aria-label="이윰 관리자 홈">
            <span className={`serif ${styles.brandName}`}>이윰</span>
            <span className={styles.brandDivider} aria-hidden="true" />
            <span className={styles.brandRole}>ADMIN</span>
          </Link>

          <AdminNavigation role={admin.role} />

          <div className={styles.sidebarFooter}>
            <Link href="/" className={styles.viewSiteLink}>
              사이트 보기
              <ExternalIcon />
            </Link>
          </div>
        </aside>

        <div className={styles.workspace}>
          <header className={styles.topbar}>
            <div>
              <p className={styles.topbarSection}>ADMINISTRATION</p>
              <p className={styles.topbarTitle}>
                <AdminCurrentSection />
              </p>
            </div>

            <div className={styles.adminAccount}>
              <span className={styles.adminAvatar} aria-hidden="true">
                {admin.displayName.slice(0, 1)}
              </span>
              <span className={styles.adminMeta}>
                <strong>{admin.displayName}</strong>
                <span>{formatRole(admin.role)}</span>
              </span>
              <form action={signOut}>
                <button type="submit" className={styles.signOutButton}>
                  로그아웃
                </button>
              </form>
            </div>
          </header>

          <main className={styles.content}>{children}</main>
        </div>
      </div>
    </AdminFeedbackProvider>
  );
}

function formatRole(role: AdminRole) {
  return role === "owner" ? "최고 관리자" : "운영 관리자";
}
