"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireOwnerAdmin } from "@/lib/admin/auth";
import {
  ADMIN_MEMBER_FILTERS,
  ADMIN_MEMBER_SORTS,
  loadAdminMembersForExport,
  type AdminEntitlementStatus,
  type AdminMember,
} from "@/lib/admin/members";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/safe-input";

export type EntitlementMutationResult = {
  ok: boolean;
  message: string;
};

export async function grantMemberEntitlementAction(
  memberId: string,
  productId: string,
  expiresAt: string | null
): Promise<EntitlementMutationResult> {
  await requireOwnerAdmin();

  if (!isUuid(memberId) || !isUuid(productId)) {
    return { ok: false, message: "회원과 지급할 상품을 다시 확인해 주세요." };
  }

  const normalizedExpiration = normalizeExpiration(expiresAt);
  if (normalizedExpiration === undefined) {
    return { ok: false, message: "만료일은 오늘 이후 날짜로 선택해 주세요." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_grant_product_entitlement", {
    target_user_id: memberId,
    target_product_id: productId,
    target_expires_at: normalizedExpiration,
  });

  if (error) {
    console.error("Failed to grant member entitlement:", error.message);
    return {
      ok: false,
      message: isSetupError(error.code)
        ? "수강권 관리 설정이 아직 적용되지 않았습니다."
        : "수강권을 지급하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  revalidateAdminEntitlements();
  return { ok: true, message: "수강권을 지급했습니다." };
}

export async function updateMemberEntitlementAction(
  entitlementId: string,
  status: AdminEntitlementStatus,
  expiresAt: string | null
): Promise<EntitlementMutationResult> {
  await requireOwnerAdmin();

  if (!isUuid(entitlementId) || !["active", "revoked"].includes(status)) {
    return { ok: false, message: "변경할 수강권 정보를 다시 확인해 주세요." };
  }

  const normalizedExpiration = normalizeExpiration(expiresAt, status === "revoked");
  if (normalizedExpiration === undefined) {
    return { ok: false, message: "만료일은 오늘 이후 날짜로 선택해 주세요." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_product_entitlement", {
    target_entitlement_id: entitlementId,
    target_status: status,
    target_expires_at: normalizedExpiration,
  });

  if (error) {
    console.error("Failed to update member entitlement:", error.message);
    return {
      ok: false,
      message: isSetupError(error.code)
        ? "수강권 관리 설정이 아직 적용되지 않았습니다."
        : "수강권을 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  revalidateAdminEntitlements();
  return {
    ok: true,
    message: status === "revoked" ? "수강권을 회수했습니다." : "수강권을 변경했습니다.",
  };
}

function normalizeExpiration(value: string | null, allowPast = false) {
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  if (!allowPast && parsed <= new Date()) return undefined;
  return parsed.toISOString();
}

function revalidateAdminEntitlements() {
  revalidatePath("/admin");
  revalidatePath("/admin/members");
  revalidatePath("/admin/orders");
  revalidatePath("/my");
}

function isSetupError(code: string | undefined) {
  return code === "42883" || code === "PGRST202" || code === "PGRST205";
}

/**
 * CSV 내보내기.
 *
 * 목록을 서버에서 자르게 되면서 브라우저에 전체 데이터가 없다. 화면에 걸린 필터
 * 그대로를 서버에서 다시 읽어 돌려준다. 인자는 신뢰하지 않고 허용값으로 좁힌다.
 */
export async function exportAdminMembersAction(input: {
  search?: string | null;
  filter?: string;
  sort?: string;
}): Promise<{ members: AdminMember[]; truncated: boolean }> {
  await requireAdmin();

  const filter = (ADMIN_MEMBER_FILTERS as readonly string[]).includes(input.filter ?? "")
    ? (input.filter as (typeof ADMIN_MEMBER_FILTERS)[number])
    : "all";
  const sort = (ADMIN_MEMBER_SORTS as readonly string[]).includes(input.sort ?? "")
    ? (input.sort as (typeof ADMIN_MEMBER_SORTS)[number])
    : "joined_desc";
  const search = typeof input.search === "string" && input.search.trim().length > 0
    ? input.search.trim()
    : null;

  return loadAdminMembersForExport({ search, filter, sort });
}
