import type { Metadata } from "next";
import AdminOrderManager from "@/components/admin/AdminOrderManager";
import { requireAdmin } from "@/lib/admin/auth";
import { loadAdminOrders } from "@/lib/admin/orders";
import { getPaymentMode } from "@/lib/store/free-enrollment";

export const metadata: Metadata = {
  title: "주문 · 결제 | 이윰 관리자",
  description: "콘텐츠 신청과 결제 내역을 확인합니다.",
};

export default async function AdminOrdersPage() {
  await requireAdmin();
  const result = await loadAdminOrders();

  return (
    <AdminOrderManager
      orders={result.orders}
      databaseReady={result.databaseReady}
      sourceMessage={result.message}
      paymentMode={getPaymentMode()}
    />
  );
}
