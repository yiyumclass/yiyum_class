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

export const AUDIT_TARGET_TYPES = [
  "product",
  "courses",
  "course_sections",
  "lessons",
  "product_entitlements",
  "order",
  "admin_user",
] as const;

export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export const AUDIT_PAGE_SIZE = 25;

export type AdminAuditPage = {
  entries: AdminAuditEntry[];
  total: number;
  page: number;
  pageCount: number;
  available: boolean;
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

  return decorateAuditRows(supabase, data ?? []);
}

/**
 * 전체 감사 로그를 페이지 단위로 읽는다. 대시보드의 최근 8건만으로는
 * 사후 추적이 불가능하다.
 */
export async function loadAdminAuditPage(options: {
  page: number;
  targetType?: AuditTargetType | null;
}): Promise<AdminAuditPage> {
  const admin = await requireAdmin();
  if (admin.role !== "owner") {
    return { entries: [], total: 0, page: 1, pageCount: 1, available: false };
  }

  const supabase = await createClient();
  const page = Number.isInteger(options.page) && options.page > 0 ? options.page : 1;
  const from = (page - 1) * AUDIT_PAGE_SIZE;

  let query = supabase
    .from("admin_audit_logs")
    .select("id, actor_user_id, action, target_type, target_id, metadata, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(from, from + AUDIT_PAGE_SIZE - 1);

  if (options.targetType) {
    query = query.eq("target_type", options.targetType);
  }

  const { data, count, error } = await query.returns<AuditRow[]>();

  if (error) {
    console.error("Failed to load the admin audit page:", error.message);
    return { entries: [], total: 0, page, pageCount: 1, available: false };
  }

  const total = count ?? 0;

  return {
    entries: await decorateAuditRows(supabase, data ?? []),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
    available: true,
  };
}

type AuditClient = Awaited<ReturnType<typeof createClient>>;

async function decorateAuditRows(
  supabase: AuditClient,
  rows: AuditRow[]
): Promise<AdminAuditEntry[]> {
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

export function isAuditTargetType(value: string | undefined): value is AuditTargetType {
  return (
    typeof value === "string" &&
    (AUDIT_TARGET_TYPES as readonly string[]).includes(value)
  );
}

function readTargetLabel(row: AuditRow) {
  const candidates = [
    row.metadata.slug,
    row.metadata.title,
    row.metadata.product_title,
    row.metadata.member_email,
    row.metadata.order_uid,
    row.metadata.refund_uid,
    row.metadata.lesson_key,
    row.metadata.section_key,
  ];
  const label = candidates.find((value): value is string => typeof value === "string" && value.length > 0);
  return label ?? row.target_id ?? row.target_type;
}
