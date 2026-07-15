import type { Metadata } from "next";
import AdminProductManager from "@/components/admin/AdminProductManager";
import { requireAdmin } from "@/lib/admin/auth";
import { loadAdminProducts } from "@/lib/admin/products";

export const metadata: Metadata = {
  title: "상품 관리 | 이윰 관리자",
  description: "강의와 전자책 판매 상품을 관리합니다.",
};

export default async function AdminProductsPage() {
  await requireAdmin();
  const result = await loadAdminProducts();

  return (
    <AdminProductManager
      products={result.products}
      databaseReady={result.databaseReady}
      sourceMessage={result.message}
    />
  );
}
