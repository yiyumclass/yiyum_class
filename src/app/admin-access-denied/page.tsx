import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import styles from "./access-denied.module.css";

export const metadata: Metadata = {
  title: "관리자 접근 확인 | 이윰 클래스",
  robots: { index: false, follow: false },
};

type AdminAccessDeniedPageProps = {
  searchParams: Promise<{ reason?: string | string[] }>;
};

export default async function AdminAccessDeniedPage({
  searchParams,
}: AdminAccessDeniedPageProps) {
  const reason = (await searchParams).reason;
  const isUnavailable = Array.isArray(reason)
    ? reason.includes("unavailable")
    : reason === "unavailable";

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
        <span className={styles.status}>{isUnavailable ? "503" : "403"}</span>
        <h1>{isUnavailable ? "관리자 권한을 확인할 수 없습니다" : "관리자 권한이 필요합니다"}</h1>
        <p>
          {isUnavailable
            ? "관리자 권한 확인에 필요한 데이터베이스 연결이 일시적으로 응답하지 않습니다."
            : "로그인한 계정에 활성화된 관리자 권한이 없습니다."}
          <br />
          {isUnavailable
            ? "잠시 후 다시 접속하거나 운영 설정 상태를 확인해 주세요."
            : "계정을 잘못 선택했다면 다시 로그인해 주세요."}
        </p>
        <div className={styles.actions}>
          <Link href={isUnavailable ? "/admin" : "/"} className={styles.primaryAction}>
            {isUnavailable ? "관리자 화면 다시 시도" : "홈으로 돌아가기"}
          </Link>
          {!isUnavailable ? (
            <form action={signOutAndRetry}>
              <button type="submit" className={styles.secondaryAction}>
                다른 계정으로 로그인
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </main>
  );
}
