import type { Metadata } from "next";
import { Suspense } from "react";
import AdminOrderManager from "@/components/admin/AdminOrderManager";
import { requireAdmin } from "@/lib/admin/auth";
import { loadAdminOrders } from "@/lib/admin/orders";
import { getPaymentMode } from "@/lib/store/free-enrollment";

export const metadata: Metadata = {
  title: "주문 · 결제 | 이윰 관리자",
  description: "콘텐츠 신청과 결제 내역을 확인합니다.",
};

export default async function AdminOrdersPage() {
  const admin = await requireAdmin();
  const result = await loadAdminOrders();

  // 검색·필터 상태를 URL 쿼리에 두므로 useSearchParams용 경계가 필요하다.
  return (
    <Suspense fallback={null}>
      <AdminOrderManager
        orders={result.orders}
        databaseReady={result.databaseReady}
        sourceMessage={result.message}
        paymentMode={getPaymentMode()}
        canRefund={admin.role === "owner"}
      />
    </Suspense>
  );
}
