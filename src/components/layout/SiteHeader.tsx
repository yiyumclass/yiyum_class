import Link from "next/link";
import { Suspense } from "react";
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

export default function SiteHeader({
  active,
  currentPath = "/",
  variant = "solid",
}: SiteHeaderProps) {
  const identityPromise = loadHeaderIdentity();
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
            <Suspense fallback={<HeaderAccountPlaceholder />}>
              <HeaderAccount
                identityPromise={identityPromise}
                loginHref={loginHref}
              />
            </Suspense>
          </div>

          <Suspense fallback={<HeaderRoleActionsPlaceholder />}>
            <HeaderRoleActions
              active={active}
              identityPromise={identityPromise}
              enrollHref={enrollHref}
            />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

async function loadHeaderIdentity() {
  const supabase = await createClient();
  return getVerifiedIdentity(supabase);
}

async function HeaderAccount({
  identityPromise,
  loginHref,
}: {
  identityPromise: ReturnType<typeof loadHeaderIdentity>;
  loginHref: string;
}) {
  const identity = await identityPromise;

  return identity ? (
    <Link href="/my" className={styles.myClassLink}>
      마이 클래스
    </Link>
  ) : (
    <Link href={loginHref} className={styles.accountLink}>
      로그인
    </Link>
  );
}

async function HeaderRoleActions({
  active,
  identityPromise,
  enrollHref,
}: {
  active?: NavigationKey;
  identityPromise: ReturnType<typeof loadHeaderIdentity>;
  enrollHref: string;
}) {
  const identity = await identityPromise;
  let isAdmin = false;

  if (identity) {
    const supabase = await createClient();
    isAdmin = await hasActiveAdminAccess(supabase, identity.userId);
  }

  return (
    <>
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
    </>
  );
}

function HeaderAccountPlaceholder() {
  return <span className={styles.accountPlaceholder} aria-hidden="true" />;
}

function HeaderRoleActionsPlaceholder() {
  return (
    <>
      <span className={styles.rolePlaceholder} aria-hidden="true" />
      <span className={styles.mobileMenuPlaceholder} aria-hidden="true" />
    </>
  );
}
