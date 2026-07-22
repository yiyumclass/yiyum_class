import Link from "next/link";
import { hasActiveAdminAccess } from "@/lib/admin/access";
import { getVerifiedIdentity } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";
import MobileMenu from "./MobileMenu";
import styles from "./SiteHeader.module.css";

type NavigationKey = "courses" | "ebook" | "reviews" | "sns" | "contact";

type SiteHeaderProps = {
  active?: NavigationKey;
  currentPath?: string;
  variant?: "solid" | "overlay";
};

const navigationItems: Array<{
  key: NavigationKey;
  label: string;
  href: string;
}> = [
  { key: "courses", label: "강의", href: "/courses" },
  {
    key: "ebook",
    label: "전자책",
    href: "/checkout?product=small-account-ebook",
  },
  { key: "reviews", label: "후기", href: "/#reviews" },
  { key: "sns", label: "SNS", href: "/sns" },
  { key: "contact", label: "문의", href: "/contact" },
];

export default async function SiteHeader({
  active,
  currentPath = "/",
  variant = "solid",
}: SiteHeaderProps) {
  const supabase = await createClient();
  const identity = await getVerifiedIdentity(supabase);
  const isAdmin = identity
    ? await hasActiveAdminAccess(supabase, identity.userId)
    : false;
  const loginHref =
    currentPath === "/" ? "/login" : `/login?next=${encodeURIComponent(currentPath)}`;
  const enrollHref = currentPath === "/" ? "#apply" : "/#apply";

  return (
    <header
      id="nav"
      className={`${styles.header} ${variant === "overlay" ? styles.overlay : styles.solid}`}
    >
      <div className={styles.inner}>
        <Link href="/" className={`serif ${styles.brand}`} aria-label="이윰 홈">
          이윰
        </Link>

        <nav className={styles.navigation} aria-label="주요 메뉴">
          {navigationItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`${styles.navLink} ${item.key === "courses" ? styles.courseLink : ""} ${active === item.key ? styles.active : ""}`}
              aria-current={active === item.key ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={styles.actions}>
          <div className={styles.accountSlot}>
            {identity ? (
              <Link href="/my" className={styles.myClassLink}>
                마이 클래스
              </Link>
            ) : (
              <Link href={loginHref} className={styles.accountLink}>
                로그인
              </Link>
            )}
          </div>

          {isAdmin ? (
            <Link href="/admin" className={styles.adminLink}>
              관리자
            </Link>
          ) : (
            <Link href={enrollHref} className={styles.enrollLink}>
              수강 신청
            </Link>
          )}

          <MobileMenu
            navItems={navigationItems}
            activeKey={active}
            isAdmin={isAdmin}
            enrollHref={enrollHref}
          />
        </div>
      </div>
    </header>
  );
}
