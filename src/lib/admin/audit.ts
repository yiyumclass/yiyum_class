import "server-only";

import { requireAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";

export type AdminAuditEntry = {
  id: number;
  action: string;
  targetType: string;
  targetLabel: string;
  actorName: string;
  createdAt: string;
};

type AuditRow = {
  id: number;
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export async function loadRecentAdminAuditEntries(): Promise<AdminAuditEntry[]> {
  const admin = await requireAdmin();
  if (admin.role !== "owner") return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("admin_audit_logs")
    .select("id, actor_user_id, action, target_type, target_id, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(8)
    .returns<AuditRow[]>();

  if (error) {
    console.error("Failed to load admin audit entries:", error.message);
    return [];
  }

  const rows = data ?? [];
  const actorIds = Array.from(
    new Set(rows.map((row) => row.actor_user_id).filter((id): id is string => Boolean(id)))
  );
  const actorNames = new Map<string, string>();

  if (actorIds.length > 0) {
    const { data: actors } = await supabase
      .from("admin_users")
      .select("user_id, display_name")
      .in("user_id", actorIds)
      .returns<Array<{ user_id: string; display_name: string | null }>>();
    for (const actor of actors ?? []) {
      actorNames.set(actor.user_id, actor.display_name || "관리자");
    }
  }

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    targetType: row.target_type,
    targetLabel: readTargetLabel(row),
    actorName: row.actor_user_id ? actorNames.get(row.actor_user_id) ?? "관리자" : "시스템",
    createdAt: row.created_at,
  }));
}

function readTargetLabel(row: AuditRow) {
  const candidates = [
    row.metadata.slug,
    row.metadata.title,
    row.metadata.product_title,
    row.metadata.member_email,
    row.metadata.lesson_key,
    row.metadata.section_key,
  ];
  const label = candidates.find((value): value is string => typeof value === "string" && value.length > 0);
  return label ?? row.target_id ?? row.target_type;
}
