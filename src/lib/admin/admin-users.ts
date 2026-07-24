import "server-only";

import type { AdminRole } from "@/lib/admin/auth";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";

export type ManagedAdminUser = {
  userId: string;
  email: string;
  role: AdminRole;
  displayName: string | null;
  isActive: boolean;
  createdAt: string;
};

type ManagedAdminRow = {
  user_id: string;
  email: string | null;
  role: AdminRole;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
};

export async function loadManagedAdminUsers(): Promise<ManagedAdminUser[]> {
  await requireOwnerAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_owner_admin_users");

  if (error) {
    console.error("Failed to load managed admin users", error);
    return [];
  }

  return ((data ?? []) as ManagedAdminRow[]).map((row) => ({
    userId: row.user_id,
    email: row.email ?? "이메일 정보 없음",
    role: row.role,
    displayName: row.display_name,
    isActive: row.is_active,
    createdAt: row.created_at,
  }));
}
