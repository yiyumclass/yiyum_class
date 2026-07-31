import type { Metadata } from "next";
import { Suspense } from "react";
import AdminMemberManager from "@/components/admin/AdminMemberManager";
import { requireAdmin } from "@/lib/admin/auth";
import { loadAdminMembers } from "@/lib/admin/members";
import type { AdminMemberProductOption } from "@/lib/admin/members";
import { loadAdminProducts } from "@/lib/admin/products";

export const metadata: Metadata = {
  title: "회원 · 수강권 | 이윰 관리자",
  description: "회원별 콘텐츠 이용권과 이용 기간을 관리합니다.",
};

export default async function AdminMembersPage() {
  const admin = await requireAdmin();
  const [memberResult, productResult] = await Promise.all([
    loadAdminMembers(),
    loadAdminProducts(),
  ]);
  const products: AdminMemberProductOption[] = productResult.products
    .filter((product) => product.source === "database" && product.status !== "archived")
    .map((product) => ({
      id: product.id,
      title: product.title,
      productType: product.productType,
      accessPeriodDays: product.accessPeriodDays,
      status: product.status === "archived" ? "paused" : product.status,
    }));

  return (
    // 검색·필터·정렬·페이지 상태를 URL 쿼리에서 읽으므로 Suspense 경계가 필요하다.
    <Suspense fallback={null}>
      <AdminMemberManager
        members={memberResult.members}
        products={products}
        databaseReady={memberResult.databaseReady && productResult.databaseReady}
        sourceMessage={memberResult.message ?? productResult.message}
        referenceTime={new Date().toISOString()}
        canManageEntitlements={admin.role === "owner"}
      />
    </Suspense>
  );
}
