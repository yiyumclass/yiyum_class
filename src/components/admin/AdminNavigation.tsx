"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/app/admin/admin.module.css";

// ownerOnly 항목은 operator에게 보여도 클릭하면 접근 거부로 튕긴다.
// 갈 수 없는 메뉴를 노출하지 않는 편이 낫다.
const navigation = [
  { label: "대시보드", icon: "dashboard", href: "/admin", ownerOnly: false },
  { label: "상품 관리", icon: "product", href: "/admin/products", ownerOnly: false },
  { label: "강의 관리", icon: "course", href: "/admin/courses", ownerOnly: false },
  { label: "주문 · 결제", icon: "order", href: "/admin/orders", ownerOnly: false },
  { label: "회원 · 수강권", icon: "member", href: "/admin/members", ownerOnly: false },
  { label: "학습 현황", icon: "progress", href: "/admin/progress", ownerOnly: false },
  { label: "운영 기록", icon: "audit", href: "/admin/audit", ownerOnly: true },
  { label: "운영자 권한", icon: "settings", href: "/admin/settings", ownerOnly: true },
] as const;

export default function AdminNavigation({ role }: { role: "owner" | "operator" }) {
  const pathname = usePathname();
  const visibleNavigation = navigation.filter(
    (item) => !item.ownerOnly || role === "owner"
  );

  return (
    <nav className={styles.navigation} aria-label="관리자 메뉴">
      <p className={styles.navigationLabel}>MANAGEMENT</p>
      <div className={styles.navigationList}>
        {visibleNavigation.map((item) => {
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
    audit: (
      <>
        <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H15l4 4v12.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5v-15Z" />
        <path d="M14.5 3v4.5H19M8.5 12.5h7M8.5 16h4.5" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.5 1a8 8 0 0 0-2.1-1.2L14 3h-4l-.4 2.6a8 8 0 0 0-2.1 1.2l-2.5-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.5-1a8 8 0 0 0 2.1 1.2L10 21h4l.4-2.6a8 8 0 0 0 2.1-1.2l2.5 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" />
      </>
    ),
  };

  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
