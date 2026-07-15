import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import styles from "./access-denied.module.css";

export const metadata: Metadata = {
  title: "접근 권한 없음 | 이윰 클래스",
  robots: { index: false, follow: false },
};

export default function AdminAccessDeniedPage() {
  const signOutAndRetry = async () => {
    "use server";
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login?next=/admin");
  };

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Link href="/" className={`serif ${styles.brand}`}>
          이윰
        </Link>
        <span className={styles.status}>403</span>
        <h1>관리자 권한이 필요합니다</h1>
        <p>
          로그인한 계정에 활성화된 관리자 권한이 없습니다.
          <br />
          계정을 잘못 선택했다면 다시 로그인해 주세요.
        </p>
        <div className={styles.actions}>
          <Link href="/" className={styles.primaryAction}>
            홈으로 돌아가기
          </Link>
          <form action={signOutAndRetry}>
            <button type="submit" className={styles.secondaryAction}>
              다른 계정으로 로그인
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
