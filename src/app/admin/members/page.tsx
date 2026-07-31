import type { Metadata } from "next";
import { Suspense } from "react";
import AdminMemberManager from "@/components/admin/AdminMemberManager";
import { requireAdmin } from "@/lib/admin/auth";
import {
  readOption,
  readPage,
  readPageSize,
  readParam,
  resolvePageWindow,
} from "@/lib/admin/list-params";
import {
  ADMIN_MEMBER_FILTERS,
  ADMIN_MEMBER_SORTS,
  loadAdminMemberPage,
} from "@/lib/admin/members";
import type { AdminMemberProductOption } from "@/lib/admin/members";
import { loadAdminProducts } from "@/lib/admin/products";

export const metadata: Metadata = {
  title: "회원 · 수강권 | 이윰 관리자",
  description: "회원별 콘텐츠 이용권과 이용 기간을 관리합니다.",
};

type AdminMembersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminMembersPage({ searchParams }: AdminMembersPageProps) {
  const admin = await requireAdmin();
  const params = await searchParams;

  const search = readParam(params.q);
  const filter = readOption(params.filter, ADMIN_MEMBER_FILTERS, "all");
  const sort = readOption(params.sort, ADMIN_MEMBER_SORTS, "joined_desc");
  const pageSize = readPageSize(params.size);
  const requestedPage = readPage(params.page);

  // 총 회원 수를 알기 전이라 첫 조회는 요청한 페이지로 나간다. 범위를 벗어났으면
  // 아래에서 보정한 뒤 한 번 더 읽는다. 마지막 페이지에서 필터를 좁혔을 때
  // 빈 표가 보이는 것을 막는다.
  const firstQuery = {
    search,
    filter,
    sort,
    limit: pageSize,
    offset: (requestedPage - 1) * pageSize,
  };

  const [initialResult, productResult] = await Promise.all([
    loadAdminMemberPage(firstQuery),
    loadAdminProducts(),
  ]);

  const { currentPage, offset } = resolvePageWindow(
    requestedPage,
    pageSize,
    initialResult.totalCount
  );

  const memberResult =
    offset === firstQuery.offset
      ? initialResult
      : await loadAdminMemberPage({ ...firstQuery, offset });

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
    // 필터 컨트롤이 URL 쿼리를 읽으므로 Suspense 경계가 필요하다.
    <Suspense fallback={null}>
      <AdminMemberManager
        members={memberResult.members}
        totalCount={memberResult.totalCount}
        summary={memberResult.summary}
        currentPage={currentPage}
        products={products}
        databaseReady={memberResult.databaseReady && productResult.databaseReady}
        sourceMessage={memberResult.message ?? productResult.message}
        referenceTime={new Date().toISOString()}
        canManageEntitlements={admin.role === "owner"}
      />
    </Suspense>
  );
}
