import "server-only";

import { requireAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";

export type AdminOrderSource = "free_checkout" | "payment" | "admin_grant";
export type AdminOrderStatus = "active" | "revoked";

export type AdminOrder = {
  id: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  productId: string;
  productTitle: string;
  productType: "course" | "ebook";
  source: AdminOrderSource;
  status: AdminOrderStatus;
  amountKrw: number | null;
  createdAt: string;
  expiresAt: string | null;
};

export type AdminOrdersResult = {
  orders: AdminOrder[];
  databaseReady: boolean;
  message: string | null;
};

type AdminOrderRow = {
  transaction_id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  product_id: string;
  product_title: string;
  product_type: "course" | "ebook";
  source: AdminOrderSource;
  entitlement_status: AdminOrderStatus;
  amount_krw: number | null;
  created_at: string;
  expires_at: string | null;
};

export async function loadAdminOrders(): Promise<AdminOrdersResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_order_ledger");

  if (error) {
    const setupRequired =
      error.code === "42883" || error.code === "PGRST202" || error.code === "PGRST205";

    if (!setupRequired) {
      console.error("Failed to load admin order ledger:", error.message);
    }

    return {
      orders: [],
      databaseReady: false,
      message: setupRequired
        ? "주문 조회용 데이터베이스 설정이 아직 적용되지 않았습니다."
        : "주문 정보를 불러오지 못했습니다. 잠시 후 페이지를 새로고침해 주세요.",
    };
  }

  const rows = Array.isArray(data) ? (data as AdminOrderRow[]) : [];

  return {
    orders: rows.map(mapAdminOrder),
    databaseReady: true,
    message: null,
  };
}

function mapAdminOrder(row: AdminOrderRow): AdminOrder {
  return {
    id: row.transaction_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    productId: row.product_id,
    productTitle: row.product_title,
    productType: row.product_type,
    source: row.source,
    status: row.entitlement_status,
    amountKrw: row.amount_krw,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
