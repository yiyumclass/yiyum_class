"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import type { AdminEntitlementStatus } from "@/lib/admin/members";
import { createClient } from "@/lib/supabase/server";

export type EntitlementMutationResult = {
  ok: boolean;
  message: string;
};

export async function grantMemberEntitlementAction(
  memberId: string,
  productId: string,
  expiresAt: string | null
): Promise<EntitlementMutationResult> {
  await requireAdmin();

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
  await requireAdmin();

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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}
