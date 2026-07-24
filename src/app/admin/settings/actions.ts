"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/safe-input";

export async function upsertAdminUserAction(formData: FormData) {
  await requireOwnerAdmin();
  const userId = readValue(formData, "userId");
  const role = readValue(formData, "role");
  const displayName = readValue(formData, "displayName");
  if (!isUuid(userId) || (role !== "owner" && role !== "operator")) {
    redirect("/admin/settings?error=invalid");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_owner_admin_user", {
    target_user_id: userId,
    target_role: role,
    target_display_name: displayName || null,
  });
  if (error) {
    console.error("Failed to upsert admin user", error);
    redirect(`/admin/settings?error=${encodeURIComponent(error.code)}`);
  }

  revalidatePath("/admin/settings");
  redirect("/admin/settings?status=saved");
}

export async function deactivateAdminUserAction(formData: FormData) {
  await requireOwnerAdmin();
  const userId = readValue(formData, "userId");
  if (!isUuid(userId)) redirect("/admin/settings?error=invalid");

  const supabase = await createClient();
  const { error } = await supabase.rpc("deactivate_owner_admin_user", {
    target_user_id: userId,
  });
  if (error) {
    console.error("Failed to deactivate admin user", error);
    redirect(`/admin/settings?error=${encodeURIComponent(error.code)}`);
  }

  revalidatePath("/admin/settings");
  redirect("/admin/settings?status=deactivated");
}

function readValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
