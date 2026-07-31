import "server-only";

import { isAuditAction } from "@/lib/admin/audit-labels";
import { requireAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/safe-input";

export type AdminAuditEntry = {
  id: number;
  action: string;
  targetType: string;
  targetLabel: string;
  actorUserId: string | null;
  actorName: string;
  createdAt: string;
  metadata: Record<string, unknown>;
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

/** 화면이 걸 수 있는 조회 조건. 모두 Supabase 쿼리 빌더로 표현 가능한 범위다. */
export type AdminAuditFilters = {
  targetType?: AuditTargetType | null;
  /** created_at 하한(ISO). 페이지가 KST 하루 경계로 환산해 넘긴다. */
  from?: string | null;
  /** created_at 상한(ISO, 포함). */
  to?: string | null;
  actorUserId?: string | null;
  action?: string | null;
};

/** 내보내기 한 번에 읽을 최대 행 수. 사고 조사 범위를 덮으면서도 응답이 터지지 않는 선. */
export const AUDIT_EXPORT_LIMIT = 2000;

/** 화면(searchParams)과 내보내기 액션이 함께 넘기는 날것의 조회 조건. */
export type AdminAuditFilterInput = {
  target?: string;
  from?: string;
  to?: string;
  actor?: string;
  action?: string;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 날짜 입력(`YYYY-MM-DD`)을 KST 하루 경계의 UTC 시각으로 바꾼다.
 * 서버가 UTC로 돌기 때문에 환산 없이 비교하면 하루가 9시간씩 밀린다.
 */
function toKstBoundary(value: string | undefined, edge: "start" | "end") {
  if (!value || !DATE_ONLY.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const kstMidnight = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(kstMidnight)) return null;
  const offset = edge === "start" ? 0 : 24 * 60 * 60 * 1000 - 1;
  return new Date(kstMidnight + offset - KST_OFFSET_MS).toISOString();
}

/** 검증되지 않은 쿼리 문자열을 조회 조건으로 좁힌다. 화면과 액션이 같은 규칙을 쓴다. */
export function resolveAuditFilters(input: AdminAuditFilterInput): AdminAuditFilters {
  return {
    targetType: isAuditTargetType(input.target) ? input.target : null,
    action: isAuditAction(input.action) ? input.action : null,
    actorUserId: input.actor && isUuid(input.actor) ? input.actor : null,
    from: toKstBoundary(input.from, "start"),
    to: toKstBoundary(input.to, "end"),
  };
}

/**
 * 전체 감사 로그를 페이지 단위로 읽는다. 대시보드의 최근 8건만으로는
 * 사후 추적이 불가능하다.
 */
export async function loadAdminAuditPage(
  options: AdminAuditFilters & { page: number }
): Promise<AdminAuditPage> {
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

  if (options.targetType) query = query.eq("target_type", options.targetType);
  if (options.action) query = query.eq("action", options.action);
  if (options.actorUserId) query = query.eq("actor_user_id", options.actorUserId);
  if (options.from) query = query.gte("created_at", options.from);
  if (options.to) query = query.lte("created_at", options.to);

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

/**
 * 내보내기용. 화면은 25건씩 끊어 보지만 CSV까지 한 페이지만 나가면 정산·사고
 * 조사에 쓸 수 없어, 같은 조건의 전체(상한까지)를 한 번에 읽는다.
 */
export async function loadAdminAuditForExport(
  filters: AdminAuditFilters
): Promise<{ entries: AdminAuditEntry[]; truncated: boolean; available: boolean }> {
  const admin = await requireAdmin();
  if (admin.role !== "owner") {
    return { entries: [], truncated: false, available: false };
  }

  const supabase = await createClient();
  let query = supabase
    .from("admin_audit_logs")
    .select("id, actor_user_id, action, target_type, target_id, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(AUDIT_EXPORT_LIMIT);

  if (filters.targetType) query = query.eq("target_type", filters.targetType);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.actorUserId) query = query.eq("actor_user_id", filters.actorUserId);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);

  const { data, error } = await query.returns<AuditRow[]>();

  if (error) {
    console.error("Failed to export the admin audit log:", error.message);
    return { entries: [], truncated: false, available: false };
  }

  const rows = data ?? [];
  return {
    entries: await decorateAuditRows(supabase, rows),
    truncated: rows.length >= AUDIT_EXPORT_LIMIT,
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
    actorUserId: row.actor_user_id,
    actorName: row.actor_user_id ? actorNames.get(row.actor_user_id) ?? "관리자" : "시스템",
    createdAt: row.created_at,
    metadata:
      typeof row.metadata === "object" && row.metadata !== null ? row.metadata : {},
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
