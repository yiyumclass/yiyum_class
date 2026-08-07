import "server-only";

import { requireAdmin } from "@/lib/admin/auth";
import { ADMIN_EXPORT_LIMIT, isSetupError } from "@/lib/admin/list-params";
import { createClient } from "@/lib/supabase/server";
import type { ProductType } from "@/lib/store/product-type";

export type AdminOrderSource = "free_checkout" | "payment" | "admin_grant";
export type AdminOrderStatus = "active" | "revoked";
export type AdminPaymentStatus = "pending" | "paid" | "canceled" | "refunded" | "failed";
export type AdminRefundStatus = "requested" | "processing" | "succeeded" | "failed";

// 진도율 정렬은 일부러 없다. 진도로 정렬하려면 자르기 전 전체 행에 학습 집계를
// 돌려야 해서 페이지를 나눈 이점이 사라진다. 진도 기준 조회는 학습 현황 화면에 있다.
export const ADMIN_ORDER_SORTS = [
  "created_desc",
  "created_asc",
  "amount_desc",
  "amount_asc",
] as const;
export type AdminOrderSort = (typeof ADMIN_ORDER_SORTS)[number];

export const ADMIN_ORDER_SOURCE_FILTERS = [
  "all",
  "free_checkout",
  "payment",
  "admin_grant",
] as const;
export const ADMIN_ORDER_STATUS_FILTERS = ["all", "active", "revoked"] as const;
export const ADMIN_ORDER_PERIODS = ["all", "today", "7days", "30days"] as const;

export type AdminOrderQuery = {
  search: string | null;
  source: (typeof ADMIN_ORDER_SOURCE_FILTERS)[number];
  status: (typeof ADMIN_ORDER_STATUS_FILTERS)[number];
  /** resolvePeriodStart가 만든 시작 시각. null이면 전체 기간. */
  since: Date | null;
  attention: boolean;
  sort: AdminOrderSort;
  limit: number;
  offset: number;
};

export type AdminOrder = {
  id: string;
  orderUid: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  productId: string;
  productSlug: string;
  productTitle: string;
  productType: ProductType;
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

export type AdminOrderSummary = {
  totalOrders: number;
  todayOrders: number;
  activeEntitlements: number;
  paidAmount: number;
  /** 필터와 무관한 전체 기준. 화면에서도 "전체 기준"이라고 밝히고 쓴다. */
  attentionTotal: number;
};

export type AdminOrdersResult = {
  orders: AdminOrder[];
  totalCount: number;
  summary: AdminOrderSummary;
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
  product_type: ProductType;
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
  total_count: number;
};

type AdminOrderSummaryRow = {
  total_orders: number;
  today_orders: number;
  active_entitlements: number;
  paid_amount: number;
  attention_total: number;
};

const emptySummary: AdminOrderSummary = {
  totalOrders: 0,
  todayOrders: 0,
  activeEntitlements: 0,
  paidAmount: 0,
  attentionTotal: 0,
};

function toRpcArgs(query: Omit<AdminOrderQuery, "limit" | "offset" | "sort">) {
  return {
    p_search: query.search,
    p_source: query.source,
    p_status: query.status,
    p_since: query.since ? query.since.toISOString() : null,
    p_attention: query.attention,
  };
}

/**
 * 목록 한 페이지와 요약을 함께 읽는다.
 *
 * 이전에는 전량을 받아 브라우저에서 걸렀다. 렌더 비용만 줄고 전송량은 그대로라
 * 행이 쌓이면 이 화면부터 느려진다. 이제 거르기·정렬·자르기를 SQL이 한다.
 *
 * 요약을 함께 받는 이유는, 페이지만 보고 집계하면 "확인된 결제액"이 페이지를
 * 넘길 때마다 달라져 매출을 오독하게 되기 때문이다.
 */
export async function loadAdminOrderPage(
  query: AdminOrderQuery
): Promise<AdminOrdersResult> {
  await requireAdmin();
  const supabase = await createClient();
  const args = toRpcArgs(query);

  const [pageResult, summaryResult] = await Promise.all([
    supabase.rpc("get_admin_order_ledger_page", {
      ...args,
      p_sort: query.sort,
      p_limit: query.limit,
      p_offset: query.offset,
    }),
    supabase.rpc("get_admin_order_ledger_summary", args),
  ]);

  const failure = pageResult.error ?? summaryResult.error;
  if (failure) {
    const setupRequired = isSetupError(failure.code);
    if (!setupRequired) {
      console.error("Failed to load admin order ledger:", failure.message);
    }

    return {
      orders: [],
      totalCount: 0,
      summary: emptySummary,
      databaseReady: false,
      message: setupRequired
        ? "주문 조회용 데이터베이스 설정이 아직 적용되지 않았습니다."
        : "주문 정보를 불러오지 못했습니다. 잠시 후 페이지를 새로고침해 주세요.",
    };
  }

  const rows = Array.isArray(pageResult.data) ? (pageResult.data as AdminOrderRow[]) : [];
  const summaryRow = (
    Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data
  ) as AdminOrderSummaryRow | null;

  return {
    orders: rows.map(mapAdminOrder),
    totalCount: Number(rows[0]?.total_count ?? summaryRow?.total_orders ?? 0),
    summary: summaryRow
      ? {
          totalOrders: Number(summaryRow.total_orders ?? 0),
          todayOrders: Number(summaryRow.today_orders ?? 0),
          activeEntitlements: Number(summaryRow.active_entitlements ?? 0),
          paidAmount: Number(summaryRow.paid_amount ?? 0),
          attentionTotal: Number(summaryRow.attention_total ?? 0),
        }
      : emptySummary,
    databaseReady: true,
    message: null,
  };
}

/**
 * 대시보드 KPI용. 목록 없이 집계만 필요할 때 페이지를 통째로 읽지 않는다.
 */
export async function loadAdminOrderSummary(): Promise<{
  summary: AdminOrderSummary;
  databaseReady: boolean;
}> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_order_ledger_summary", {
    p_search: null,
    p_source: "all",
    p_status: "all",
    p_since: null,
    p_attention: false,
  });

  if (error) {
    if (!isSetupError(error.code)) {
      console.error("Failed to load admin order summary:", error.message);
    }
    return { summary: emptySummary, databaseReady: false };
  }

  const row = (Array.isArray(data) ? data[0] : data) as AdminOrderSummaryRow | null;
  return {
    summary: row
      ? {
          totalOrders: Number(row.total_orders ?? 0),
          todayOrders: Number(row.today_orders ?? 0),
          activeEntitlements: Number(row.active_entitlements ?? 0),
          paidAmount: Number(row.paid_amount ?? 0),
          attentionTotal: Number(row.attention_total ?? 0),
        }
      : emptySummary,
    databaseReady: true,
  };
}

/**
 * CSV용. 화면에 걸린 필터 그대로의 전체를 읽되 상한을 둔다.
 * 상한에 걸리면 화면이 "일부만 내려받았다"고 알려야 한다.
 */
export async function loadAdminOrdersForExport(
  query: Omit<AdminOrderQuery, "limit" | "offset">
): Promise<{ orders: AdminOrder[]; truncated: boolean }> {
  await requireAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_admin_order_ledger_page", {
    ...toRpcArgs(query),
    p_sort: query.sort,
    p_limit: ADMIN_EXPORT_LIMIT,
    p_offset: 0,
  });

  if (error) {
    console.error("Failed to export admin orders:", error.message);
    return { orders: [], truncated: false };
  }

  const rows = Array.isArray(data) ? (data as AdminOrderRow[]) : [];
  return {
    orders: rows.map(mapAdminOrder),
    truncated: Number(rows[0]?.total_count ?? 0) > rows.length,
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
