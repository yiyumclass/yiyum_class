import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AdminRole = "owner" | "operator";

export type AdminIdentity = {
  userId: string;
  email: string;
  displayName: string;
  role: AdminRole;
};

type AdminAccessResult =
  | { status: "granted"; admin: AdminIdentity }
  | { status: "unauthenticated" }
  | { status: "denied" }
  | { status: "unavailable" };

type AdminRow = {
  role: AdminRole;
  display_name: string | null;
  is_active: boolean;
};

/**
 * 관리자 권한의 단일 진입점.
 * 사용자 메타데이터나 이메일이 아니라 RLS가 적용된 admin_users를 매 요청 확인한다.
 */
export const getAdminAccess = cache(async (): Promise<AdminAccessResult> => {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { status: "unauthenticated" };
  }

  const { data, error } = await supabase
    .from("admin_users")
    .select("role, display_name, is_active")
    .eq("user_id", user.id)
    .maybeSingle<AdminRow>();

  if (error) {
    console.error("Failed to verify admin access:", error.message);
    return { status: "unavailable" };
  }

  if (!data?.is_active || !isAdminRole(data.role)) {
    return { status: "denied" };
  }

  const metadataName = user.user_metadata?.nickname ?? user.user_metadata?.name;
  const fallbackName =
    typeof metadataName === "string" && metadataName.trim()
      ? metadataName.trim()
      : "관리자";

  return {
    status: "granted",
    admin: {
      userId: user.id,
      email: user.email ?? "이메일 정보 없음",
      displayName: data.display_name?.trim() || fallbackName,
      role: data.role,
    },
  };
});

export const requireAdmin = cache(async (): Promise<AdminIdentity> => {
  const access = await getAdminAccess();

  if (access.status === "unauthenticated") {
    redirect("/login?next=/admin");
  }

  if (access.status !== "granted") {
    redirect("/admin-access-denied");
  }

  return access.admin;
});

function isAdminRole(value: unknown): value is AdminRole {
  return value === "owner" || value === "operator";
}
