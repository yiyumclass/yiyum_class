/**
 * 관리자 메뉴 정의의 단일 출처.
 * 사이드바와 상단 현재 위치 표시가 같은 목록을 봐야 어긋나지 않는다.
 *
 * ownerOnly 항목은 operator에게 보여도 클릭하면 접근 거부로 튕긴다.
 * 갈 수 없는 메뉴를 노출하지 않는 편이 낫다.
 */
export const adminNavigation = [
  { label: "대시보드", icon: "dashboard", href: "/admin", ownerOnly: false },
  { label: "상품 관리", icon: "product", href: "/admin/products", ownerOnly: false },
  { label: "강의 관리", icon: "course", href: "/admin/courses", ownerOnly: false },
  { label: "주문 · 결제", icon: "order", href: "/admin/orders", ownerOnly: false },
  { label: "회원 · 수강권", icon: "member", href: "/admin/members", ownerOnly: false },
  { label: "학습 현황", icon: "progress", href: "/admin/progress", ownerOnly: false },
  { label: "운영 기록", icon: "audit", href: "/admin/audit", ownerOnly: true },
  { label: "운영자 권한", icon: "settings", href: "/admin/settings", ownerOnly: true },
] as const;

export type AdminNavIconName = (typeof adminNavigation)[number]["icon"];

export function isActiveNavHref(href: string, pathname: string) {
  return href === "/admin" ? pathname === href : pathname.startsWith(href);
}

export function findAdminNavLabel(pathname: string) {
  // 더 깊은 경로가 먼저 잡히도록 뒤에서부터 확인한다.
  const matched = [...adminNavigation]
    .reverse()
    .find((item) => isActiveNavHref(item.href, pathname));
  return matched?.label ?? "운영 관리";
}
