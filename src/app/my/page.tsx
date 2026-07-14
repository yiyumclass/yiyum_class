import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import MyClassLibrary from "@/components/my/MyClassLibrary";
import SiteFooter from "@/components/layout/SiteFooter";
import { courses, previewCourseProgress } from "@/lib/learning/catalog";
import { loadCourseProgress } from "@/lib/learning/progress";
import { buildMyClassItems } from "@/lib/my-class/library-data";
import { createClient } from "@/lib/supabase/server";
import styles from "./my.module.css";

export const metadata: Metadata = {
  title: "마이 클래스 | 이윰 클래스",
  description: "구매한 VOD 강의와 전자책, 수강 진도를 확인하세요.",
};

export default async function MyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/my");
  }

  const meta = user.user_metadata ?? {};
  const rawDisplayName = meta.nickname ?? meta.name ?? meta.full_name;
  const displayName =
    typeof rawDisplayName === "string" && rawDisplayName.trim()
      ? rawDisplayName.trim()
      : "회원";
  const initial = displayName.slice(0, 1) || "회";
  const course = courses[0];
  const progressResult = await loadCourseProgress(supabase, course);
  const progress = progressResult.available
    ? progressResult.progress
    : previewCourseProgress[course.slug];
  const items = buildMyClassItems(course, progress);

  const signOut = async () => {
    "use server";
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/");
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={`serif ${styles.brand}`}>
            이윰
          </Link>

          <nav className={styles.accountNav} aria-label="회원 메뉴">
            <Link href="/my" className={styles.navActive} aria-current="page">
              마이 클래스
            </Link>
            <span className={styles.navSoon} aria-disabled="true">
              주문 내역
            </span>
          </nav>

          <div className={styles.userArea}>
            <span className={styles.avatar} aria-hidden="true">
              {initial}
            </span>
            <span className={styles.userName}>{displayName}님</span>
            <form action={signOut}>
              <button type="submit" className={styles.logoutButton} aria-label="로그아웃">
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <MyClassLibrary displayName={displayName} items={items} />
      </main>

      <SiteFooter variant="compact" />
    </div>
  );
}
