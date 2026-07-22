import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type MyOrderSource = "free_checkout" | "payment" | "admin_grant";
export type MyPaymentStatus =
  | "pending"
  | "paid"
  | "canceled"
  | "refunded"
  | "failed";
export type MyEntitlementStatus = "active" | "expired" | "revoked" | "none";
export type MyRefundStatus = "requested" | "processing" | "succeeded" | "failed";

export type MyOrder = {
  id: string;
  orderUid: string;
  productSlug: string;
  productTitle: string;
  productType: "course" | "ebook";
  amountKrw: number;
  source: MyOrderSource;
  paymentStatus: MyPaymentStatus;
  entitlementStatus: MyEntitlementStatus;
  orderedAt: string;
  approvedAt: string | null;
  refundedAt: string | null;
  expiresAt: string | null;
  refundStatus: MyRefundStatus | null;
  refundAmountKrw: number | null;
  refundPolicyAgreedAt: string | null;
};

export type MyOrdersResult = {
  orders: MyOrder[];
  databaseReady: boolean;
  message: string | null;
};

type MyOrderRow = {
  transaction_id: string;
  order_uid: string;
  product_slug: string;
  product_title: string;
  product_type: MyOrder["productType"];
  amount_krw: number;
  source: MyOrderSource;
  payment_status: MyPaymentStatus;
  entitlement_status: MyEntitlementStatus;
  ordered_at: string;
  approved_at: string | null;
  refunded_at: string | null;
  expires_at: string | null;
  refund_status: MyRefundStatus | null;
  refund_amount_krw: number | null;
  refund_policy_agreed_at: string | null;
};

export async function loadMyOrders(
  supabase: SupabaseClient
): Promise<MyOrdersResult> {
  const { data, error } = await supabase.rpc("get_my_order_ledger");

  if (error) {
    const setupRequired =
      error.code === "42883" ||
      error.code === "PGRST202" ||
      error.code === "PGRST205";

    if (!setupRequired) {
      console.error("Failed to load member order ledger:", error.message);
    }

    return {
      orders: [],
      databaseReady: false,
      message: setupRequired
        ? "주문 조회 설정을 적용하고 있습니다. 잠시 후 다시 확인해 주세요."
        : "주문 내역을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.",
    };
  }

  const rows = Array.isArray(data) ? (data as MyOrderRow[]) : [];

  return {
    orders: rows.map((row) => ({
      id: row.transaction_id,
      orderUid: row.order_uid,
      productSlug: row.product_slug,
      productTitle: row.product_title,
      productType: row.product_type,
      amountKrw: Number(row.amount_krw),
      source: row.source,
      paymentStatus: row.payment_status,
      entitlementStatus: row.entitlement_status,
      orderedAt: row.ordered_at,
      approvedAt: row.approved_at,
      refundedAt: row.refunded_at,
      expiresAt: row.expires_at,
      refundStatus: row.refund_status,
      refundAmountKrw:
        row.refund_amount_krw === null ? null : Number(row.refund_amount_krw),
      refundPolicyAgreedAt: row.refund_policy_agreed_at,
    })),
    databaseReady: true,
    message: null,
  };
}
