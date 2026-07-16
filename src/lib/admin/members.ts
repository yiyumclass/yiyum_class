import "server-only";

import { requireAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";

export type AdminEntitlementSource = "free_checkout" | "payment" | "admin_grant";
export type AdminEntitlementStatus = "active" | "revoked";

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
  status: "draft" | "active" | "paused";
};

export type AdminMembersResult = {
  members: AdminMember[];
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
};

export async function loadAdminMembers(): Promise<AdminMembersResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_member_entitlements");

  if (error) {
    const setupRequired =
      error.code === "42883" || error.code === "PGRST202" || error.code === "PGRST205";

    if (!setupRequired) {
      console.error("Failed to load admin members:", error.message);
    }

    return {
      members: [],
      databaseReady: false,
      message: setupRequired
        ? "회원·수강권 관리용 데이터베이스 설정이 아직 적용되지 않았습니다."
        : "회원 정보를 불러오지 못했습니다. 잠시 후 페이지를 새로고침해 주세요.",
    };
  }

  const rows = Array.isArray(data) ? (data as AdminMemberRow[]) : [];
  return {
    members: groupMemberRows(rows),
    databaseReady: true,
    message: null,
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
