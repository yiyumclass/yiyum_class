import "server-only";

import { requireAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";

export type AdminOrderSource = "free_checkout" | "payment" | "admin_grant";
export type AdminOrderStatus = "active" | "revoked";
export type AdminPaymentStatus = "pending" | "paid" | "canceled" | "refunded" | "failed";
export type AdminRefundStatus = "requested" | "processing" | "succeeded" | "failed";

export type AdminOrder = {
  id: string;
  orderUid: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  productId: string;
  productSlug: string;
  productTitle: string;
  productType: "course" | "ebook";
  source: AdminOrderSource;
  status: AdminOrderStatus;
  paymentStatus: AdminPaymentStatus;
  amountKrw: number | null;
  createdAt: string;
  approvedAt: string | null;
  refundedAt: string | null;
  expiresAt: string | null;
  paymentKeyPresent: boolean;
  refundStatus: AdminRefundStatus | null;
  refundAmountKrw: number | null;
  learning: {
    totalLessons: number;
    startedLessons: number;
    completedLessons: number;
    watchedSeconds: number;
    progressPercent: number;
    firstWatchedAt: string | null;
    lastWatchedAt: string | null;
  };
};

export type AdminOrdersResult = {
  orders: AdminOrder[];
  databaseReady: boolean;
  message: string | null;
};

type AdminOrderRow = {
  transaction_id: string;
  order_uid: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  product_id: string;
  product_slug: string;
  product_title: string;
  product_type: "course" | "ebook";
  source: AdminOrderSource;
  payment_status: AdminPaymentStatus;
  entitlement_status: AdminOrderStatus;
  amount_krw: number | null;
  created_at: string;
  approved_at: string | null;
  refunded_at: string | null;
  expires_at: string | null;
  payment_key_present: boolean;
  refund_status: AdminRefundStatus | null;
  refund_amount: number | null;
  total_lessons: number;
  started_lessons: number;
  completed_lessons: number;
  watched_seconds: number;
  progress_percent: number;
  first_watched_at: string | null;
  last_watched_at: string | null;
};

export async function loadAdminOrders(): Promise<AdminOrdersResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_refund_order_ledger");

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
    orderUid: row.order_uid,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    productId: row.product_id,
    productSlug: row.product_slug,
    productTitle: row.product_title,
    productType: row.product_type,
    source: row.source,
    status: row.entitlement_status,
    paymentStatus: row.payment_status,
    amountKrw: row.amount_krw,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    refundedAt: row.refunded_at,
    expiresAt: row.expires_at,
    paymentKeyPresent: row.payment_key_present,
    refundStatus: row.refund_status,
    refundAmountKrw: row.refund_amount,
    learning: {
      totalLessons: Number(row.total_lessons ?? 0),
      startedLessons: Number(row.started_lessons ?? 0),
      completedLessons: Number(row.completed_lessons ?? 0),
      watchedSeconds: Number(row.watched_seconds ?? 0),
      progressPercent: Number(row.progress_percent ?? 0),
      firstWatchedAt: row.first_watched_at,
      lastWatchedAt: row.last_watched_at,
    },
  };
}
