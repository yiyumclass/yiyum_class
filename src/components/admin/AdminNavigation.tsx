"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/app/admin/admin.module.css";

const navigation = [
  { label: "대시보드", icon: "dashboard", href: "/admin" },
  { label: "상품 관리", icon: "product", href: "/admin/products" },
  { label: "강의 관리", icon: "course", href: "/admin/courses" },
  { label: "전자책 관리", icon: "ebook" },
  { label: "주문 · 결제", icon: "order", href: "/admin/orders" },
  { label: "회원 · 수강권", icon: "member", href: "/admin/members" },
  { label: "학습 현황", icon: "progress", href: "/admin/progress" },
  { label: "운영 설정", icon: "settings" },
] as const;

export default function AdminNavigation() {
  const pathname = usePathname();

  return (
    <nav className={styles.navigation} aria-label="관리자 메뉴">
      <p className={styles.navigationLabel}>MANAGEMENT</p>
      <div className={styles.navigationList}>
        {navigation.map((item) => {
          if (!("href" in item)) {
            return (
              <span
                key={item.label}
                className={styles.navItemDisabled}
                aria-disabled="true"
              >
                <AdminNavIcon name={item.icon} />
                <span>{item.label}</span>
                <span className={styles.navBadge}>준비 중</span>
              </span>
            );
          }

          const isActive =
            item.href === "/admin"
              ? pathname === item.href
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.label}
              href={item.href}
              className={isActive ? styles.navItemActive : styles.navItem}
              aria-current={isActive ? "page" : undefined}
            >
              <AdminNavIcon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

type AdminNavIconName = (typeof navigation)[number]["icon"];

function AdminNavIcon({ name }: { name: AdminNavIconName }) {
  const paths: Record<AdminNavIconName, React.ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    product: (
      <>
        <path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z" />
        <path d="m4 12 8 4.5 8-4.5M4 16.5 12 21l8-4.5" />
      </>
    ),
    course: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m10 9 5 3-5 3V9Z" />
      </>
    ),
    ebook: (
      <>
        <path d="M5 4.5h9a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5Z" />
        <path d="M17 7.5h2a2 2 0 0 1 2 2V20h-4M8 8h5M8 11.5h5" />
      </>
    ),
    order: (
      <>
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </>
    ),
    member: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 11a3 3 0 0 1 4.5 2.6M17 16a4 4 0 0 1 4 3" />
      </>
    ),
    progress: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20V7" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.1.36.3.7.6 1 .3.27.7.4 1.1.4h.09v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
      </>
    ),
  };

  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
