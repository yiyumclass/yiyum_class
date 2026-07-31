"use server";

import {
  loadAdminAuditForExport,
  resolveAuditFilters,
  type AdminAuditFilterInput,
} from "@/lib/admin/audit";
import {
  describeAuditMetadata,
  formatAuditAction,
  formatAuditTarget,
  formatAuditTimestamp,
} from "@/lib/admin/audit-labels";
import { requireOwnerAdmin } from "@/lib/admin/auth";

export type AuditExportRow = {
  createdAt: string;
  target: string;
  action: string;
  targetLabel: string;
  actorName: string;
  details: string;
};

export type AuditExportResult = {
  ok: boolean;
  rows: AuditExportRow[];
  truncated: boolean;
};

/**
 * 화면은 25건씩 끊어 보므로, 현재 페이지만 내보내면 CSV가 사고 조사에 쓸모가 없다.
 * 같은 조건의 전체를 서버에서 다시 읽어 내려보낸다. 입력은 클라이언트에서 오므로
 * 조건은 서버에서 다시 검증한다.
 */
export async function exportAuditLogAction(
  input: AdminAuditFilterInput
): Promise<AuditExportResult> {
  await requireOwnerAdmin();

  const { entries, truncated, available } = await loadAdminAuditForExport(
    resolveAuditFilters(input ?? {})
  );

  if (!available) return { ok: false, rows: [], truncated: false };

  return {
    ok: true,
    truncated,
    rows: entries.map((entry) => ({
      createdAt: formatAuditTimestamp(entry.createdAt),
      target: formatAuditTarget(entry.targetType),
      action: formatAuditAction(entry.action),
      targetLabel: entry.targetLabel,
      actorName: entry.actorName,
      details: describeAuditMetadata(entry.metadata)
        .map((row) =>
          row.before === null
            ? `${row.label}: ${row.after}`
            : `${row.label}: ${row.before} → ${row.after}`
        )
        .join(" / "),
    })),
  };
}
