import type { Metadata } from "next";
import { Suspense } from "react";
import AdminOrderManager from "@/components/admin/AdminOrderManager";
import { requireAdmin } from "@/lib/admin/auth";
import {
  readOption,
  readPage,
  readPageSize,
  readParam,
  resolvePageWindow,
  resolvePeriodStart,
} from "@/lib/admin/list-params";
import {
  ADMIN_ORDER_PERIODS,
  ADMIN_ORDER_PRODUCT_TYPE_FILTERS,
  ADMIN_ORDER_SORTS,
  ADMIN_ORDER_SOURCE_FILTERS,
  ADMIN_ORDER_STATUS_FILTERS,
  loadAdminOrderPage,
  type AdminOrderQuery,
} from "@/lib/admin/orders";
import { getPaymentMode } from "@/lib/store/free-enrollment";

export const metadata: Metadata = {
  title: "주문 · 결제 | 이윰 관리자",
  description: "콘텐츠 신청과 결제 내역을 확인합니다.",
};

type OrdersSearchParams = Record<string, string | string[] | undefined>;

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<OrdersSearchParams>;
}) {
  const admin = await requireAdmin();
  const params = await searchParams;

  // URL은 관리자가 손으로 고칠 수 있다. SQL로 내려보내기 전에 허용값으로 좁힌다.
  const period = readOption(params.period, ADMIN_ORDER_PERIODS, "all");
  const pageSize = readPageSize(params.size);
  const requestedPage = readPage(params.page);
  const filters = {
    search: readParam(params.q),
    productType: readOption(params.type, ADMIN_ORDER_PRODUCT_TYPE_FILTERS, "all"),
    source: readOption(params.source, ADMIN_ORDER_SOURCE_FILTERS, "all"),
    status: readOption(params.status, ADMIN_ORDER_STATUS_FILTERS, "all"),
    since: resolvePeriodStart(period),
    attention: readParam(params.attention) === "1",
    sort: readOption(params.sort, ADMIN_ORDER_SORTS, "created_desc"),
  } satisfies Omit<AdminOrderQuery, "limit" | "offset">;

  let result = await loadAdminOrderPage({
    ...filters,
    limit: pageSize,
    offset: (requestedPage - 1) * pageSize,
  });

  // 필터를 좁히면 보고 있던 페이지가 범위 밖으로 밀려난다. 빈 표를 보여주는 대신
  // 마지막 페이지로 당겨 다시 읽는다. 총 건수를 알기 전에는 보정할 수 없다.
  const window = resolvePageWindow(requestedPage, pageSize, result.totalCount);
  if (window.currentPage !== requestedPage && result.totalCount > 0) {
    result = await loadAdminOrderPage({
      ...filters,
      limit: pageSize,
      offset: window.offset,
    });
  }

  // 검색·필터 상태를 URL 쿼리에 두므로 useSearchParams용 경계가 필요하다.
  return (
    <Suspense fallback={null}>
      <AdminOrderManager
        orders={result.orders}
        totalCount={result.totalCount}
        summary={result.summary}
        page={window.currentPage}
        pageSize={pageSize}
        databaseReady={result.databaseReady}
        sourceMessage={result.message}
        paymentMode={getPaymentMode()}
        canRefund={admin.role === "owner"}
      />
    </Suspense>
  );
}
