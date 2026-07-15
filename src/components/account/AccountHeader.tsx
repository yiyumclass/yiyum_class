import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import styles from "./AccountHeader.module.css";

type AccountNavigationKey = "classes" | "orders" | "settings";

type AccountHeaderProps = {
  active: AccountNavigationKey;
  displayName: string;
};

const accountNavigation = [
  { key: "classes", label: "마이 클래스", href: "/my" },
  { key: "orders", label: "주문 내역", href: null },
  { key: "settings", label: "계정 설정", href: "/account/settings" },
] as const;

export default function AccountHeader({
  active,
  displayName,
}: AccountHeaderProps) {
  const initial = displayName.slice(0, 1) || "회";

  const signOut = async () => {
    "use server";
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
    redirect("/");
  };

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href="/" className={`serif ${styles.brand}`} aria-label="이윰 홈">
          이윰
        </Link>

        <nav className={styles.accountNav} aria-label="회원 메뉴">
          {accountNavigation.map((item) => {
            if (!item.href) {
              return (
                <span key={item.key} className={styles.navSoon} aria-disabled="true">
                  {item.label}
                  <span className={styles.soonBadge}>준비 중</span>
                </span>
              );
            }

            const isActive = item.key === active;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={isActive ? styles.navActive : styles.navLink}
                aria-current={isActive ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
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
  );
}
