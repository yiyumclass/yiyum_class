import "server-only";

import { requireAdmin } from "@/lib/admin/auth";
import { ADMIN_EXPORT_LIMIT, isSetupError } from "@/lib/admin/list-params";
import { createClient } from "@/lib/supabase/server";

export type AdminEntitlementSource = "free_checkout" | "payment" | "admin_grant";
export type AdminEntitlementStatus = "active" | "revoked";

export const ADMIN_MEMBER_FILTERS = [
  "all",
  "entitled",
  "unentitled",
  "expiring",
] as const;

export const ADMIN_MEMBER_SORTS = [
  "joined_desc",
  "joined_asc",
  "name",
  "entitlements_desc",
  "signin_desc",
] as const;

export type AdminMemberQuery = {
  search: string | null;
  filter: (typeof ADMIN_MEMBER_FILTERS)[number];
  sort: (typeof ADMIN_MEMBER_SORTS)[number];
  limit: number;
  offset: number;
};

export type AdminMemberEntitlement = {
  id: string;
  productId: string;
  productTitle: string;
  productType: "course" | "ebook";
  source: AdminEntitlementSource;
  status: AdminEntitlementStatus;
  grantedAt: string;
  expiresAt: string | null;
  accessPeriodDays: number | null;
};

export type AdminMember = {
  id: string;
  email: string;
  name: string;
  joinedAt: string;
  lastSignInAt: string | null;
  entitlements: AdminMemberEntitlement[];
};

export type AdminMemberProductOption = {
  id: string;
  title: string;
  productType: "course" | "ebook";
  accessPeriodDays: number | null;
  status: "draft" | "active" | "sold_out" | "paused";
};

export type AdminMemberSummary = {
  totalMembers: number;
  activeEntitlements: number;
  newMembers: number;
  expiringEntitlements: number;
};

export type AdminMembersResult = {
  members: AdminMember[];
  /** 회원 수다. 회원×수강권 행 수가 아니다. */
  totalCount: number;
  summary: AdminMemberSummary;
  databaseReady: boolean;
  message: string | null;
};

type AdminMemberRow = {
  member_id: string;
  member_email: string;
  member_name: string;
  joined_at: string;
  last_sign_in_at: string | null;
  entitlement_id: string | null;
  product_id: string | null;
  product_title: string | null;
  product_type: "course" | "ebook" | null;
  entitlement_source: AdminEntitlementSource | null;
  entitlement_status: AdminEntitlementStatus | null;
  granted_at: string | null;
  expires_at: string | null;
  access_period_days: number | null;
  total_count: number;
};

type AdminMemberSummaryRow = {
  total_members: number;
  active_entitlements: number;
  new_members: number;
  expiring_entitlements: number;
};

const emptySummary: AdminMemberSummary = {
  totalMembers: 0,
  activeEntitlements: 0,
  newMembers: 0,
  expiringEntitlements: 0,
};

/**
 * 회원 목록 한 페이지와 요약.
 *
 * 페이지를 회원 단위로 자른다. 수강권은 회원에 딸린 목록이라 행 단위로 자르면
 * 한 회원의 수강권이 페이지 경계에서 잘린다. RPC가 회원×수강권 행을 돌려주므로
 * 여기서 회원 단위로 다시 묶는다.
 */
export async function loadAdminMemberPage(
  query: AdminMemberQuery
): Promise<AdminMembersResult> {
  await requireAdmin();
  const supabase = await createClient();

  const [pageResult, summaryResult] = await Promise.all([
    supabase.rpc("get_admin_member_entitlements_page", {
      p_search: query.search,
      p_filter: query.filter,
      p_sort: query.sort,
      p_limit: query.limit,
      p_offset: query.offset,
    }),
    supabase.rpc("get_admin_member_summary", {
      p_search: query.search,
      p_filter: query.filter,
    }),
  ]);

  const failure = pageResult.error ?? summaryResult.error;
  if (failure) {
    const setupRequired = isSetupError(failure.code);
    if (!setupRequired) {
      console.error("Failed to load admin members:", failure.message);
    }

    return {
      members: [],
      totalCount: 0,
      summary: emptySummary,
      databaseReady: false,
      message: setupRequired
        ? "회원·수강권 관리용 데이터베이스 설정이 아직 적용되지 않았습니다."
        : "회원 정보를 불러오지 못했습니다. 잠시 후 페이지를 새로고침해 주세요.",
    };
  }

  const rows = Array.isArray(pageResult.data) ? (pageResult.data as AdminMemberRow[]) : [];
  const summaryRow = (
    Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data
  ) as AdminMemberSummaryRow | null;

  return {
    members: groupMemberRows(rows),
    totalCount: Number(rows[0]?.total_count ?? summaryRow?.total_members ?? 0),
    summary: summaryRow
      ? {
          totalMembers: Number(summaryRow.total_members ?? 0),
          activeEntitlements: Number(summaryRow.active_entitlements ?? 0),
          newMembers: Number(summaryRow.new_members ?? 0),
          expiringEntitlements: Number(summaryRow.expiring_entitlements ?? 0),
        }
      : emptySummary,
    databaseReady: true,
    message: null,
  };
}

/** 대시보드 KPI용. 집계만 필요할 때 목록을 통째로 읽지 않는다. */
export async function loadAdminMemberSummary(): Promise<{
  summary: AdminMemberSummary;
  databaseReady: boolean;
}> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_member_summary", {
    p_search: null,
    p_filter: "all",
  });

  if (error) {
    if (!isSetupError(error.code)) {
      console.error("Failed to load admin member summary:", error.message);
    }
    return { summary: emptySummary, databaseReady: false };
  }

  const row = (Array.isArray(data) ? data[0] : data) as AdminMemberSummaryRow | null;
  return {
    summary: row
      ? {
          totalMembers: Number(row.total_members ?? 0),
          activeEntitlements: Number(row.active_entitlements ?? 0),
          newMembers: Number(row.new_members ?? 0),
          expiringEntitlements: Number(row.expiring_entitlements ?? 0),
        }
      : emptySummary,
    databaseReady: true,
  };
}

/** 운영자 권한 화면의 회원 선택기가 쓰는 경량 목록. */
export type AdminMemberOption = { id: string; name: string; email: string };

/**
 * 회원 선택기용 목록.
 *
 * 선택기는 브라우저에서 입력값으로 걸러야 반응이 빠르므로 목록을 미리 받는다.
 * 대신 상한을 두고, 상한에 걸리면 화면이 "직접 입력"으로 안내하게 truncated를 함께 준다.
 */
export async function loadAdminMemberOptions(
  limit = 500
): Promise<{ options: AdminMemberOption[]; truncated: boolean; databaseReady: boolean }> {
  await requireAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_admin_member_entitlements_page", {
    p_search: null,
    p_filter: "all",
    p_sort: "joined_desc",
    p_limit: limit,
    p_offset: 0,
  });

  if (error) {
    if (!isSetupError(error.code)) {
      console.error("Failed to load admin member options:", error.message);
    }
    return { options: [], truncated: false, databaseReady: false };
  }

  const rows = Array.isArray(data) ? (data as AdminMemberRow[]) : [];
  const options = groupMemberRows(rows).map((member) => ({
    id: member.id,
    name: member.name,
    email: member.email,
  }));

  return {
    options,
    truncated: Number(rows[0]?.total_count ?? 0) > options.length,
    databaseReady: true,
  };
}

/** CSV용. 걸러진 전체를 읽되 상한을 둔다. */
export async function loadAdminMembersForExport(
  query: Omit<AdminMemberQuery, "limit" | "offset">
): Promise<{ members: AdminMember[]; truncated: boolean }> {
  await requireAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_admin_member_entitlements_page", {
    p_search: query.search,
    p_filter: query.filter,
    p_sort: query.sort,
    p_limit: ADMIN_EXPORT_LIMIT,
    p_offset: 0,
  });

  if (error) {
    console.error("Failed to export admin members:", error.message);
    return { members: [], truncated: false };
  }

  const rows = Array.isArray(data) ? (data as AdminMemberRow[]) : [];
  const members = groupMemberRows(rows);
  return {
    members,
    truncated: Number(rows[0]?.total_count ?? 0) > members.length,
  };
}

function groupMemberRows(rows: AdminMemberRow[]) {
  const members = new Map<string, AdminMember>();

  for (const row of rows) {
    const member = members.get(row.member_id) ?? {
      id: row.member_id,
      email: row.member_email,
      name: row.member_name,
      joinedAt: row.joined_at,
      lastSignInAt: row.last_sign_in_at,
      entitlements: [],
    };

    if (
      row.entitlement_id &&
      row.product_id &&
      row.product_title &&
      row.product_type &&
      row.entitlement_source &&
      row.entitlement_status &&
      row.granted_at
    ) {
      member.entitlements.push({
        id: row.entitlement_id,
        productId: row.product_id,
        productTitle: row.product_title,
        productType: row.product_type,
        source: row.entitlement_source,
        status: row.entitlement_status,
        grantedAt: row.granted_at,
        expiresAt: row.expires_at,
        accessPeriodDays: row.access_period_days,
      });
    }

    members.set(row.member_id, member);
  }

  return Array.from(members.values());
}
