"use client";

import { useState, useTransition } from "react";
import { useAdminFeedback } from "@/components/admin/AdminFeedback";
import { DownloadIcon } from "@/components/admin/icons";
import {
  exportAuditLogAction,
  type AuditExportRow,
} from "@/app/admin/audit/actions";
import { exportRowsToCsv } from "@/lib/admin/csv";
import type { AdminAuditFilterInput } from "@/lib/admin/audit";

const COLUMNS = [
  { header: "일시", value: (row: AuditExportRow) => row.createdAt },
  { header: "대상", value: (row: AuditExportRow) => row.target },
  { header: "변경 내용", value: (row: AuditExportRow) => row.action },
  { header: "식별자", value: (row: AuditExportRow) => row.targetLabel },
  { header: "수행자", value: (row: AuditExportRow) => row.actorName },
  { header: "상세", value: (row: AuditExportRow) => row.details },
];

/**
 * 운영 기록은 서버 페이지네이션이라 화면에 있는 25건만으로는 내보낼 의미가 없다.
 * 현재 걸린 조건 그대로를 서버에서 다시 읽어 CSV로 만든다.
 */
export default function AdminAuditCsvButton({
  filters,
  disabled,
  className,
}: {
  filters: AdminAuditFilterInput;
  disabled?: boolean;
  className?: string;
}) {
  const { toast } = useAdminFeedback();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const handleExport = () => {
    setBusy(true);
    startTransition(async () => {
      try {
        const result = await exportAuditLogAction(filters);
        if (!result.ok) {
          toast("운영 기록을 불러오지 못해 내보내지 못했습니다.", "error");
          return;
        }
        if (result.rows.length === 0) {
          toast("내보낼 기록이 없습니다.", "error");
          return;
        }
        exportRowsToCsv({
          fileName: "이윰-운영기록",
          columns: COLUMNS,
          rows: result.rows,
        });
        toast(
          result.truncated
            ? `${result.rows.length}건을 내보냈습니다. 최대치에 도달해 기간을 좁히면 나머지도 받을 수 있습니다.`
            : `${result.rows.length}건을 내보냈습니다.`,
          "success"
        );
      } catch (error) {
        console.error("Failed to export the audit log:", error);
        toast("내보내는 중 오류가 발생했습니다.", "error");
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <button
      type="button"
      className={className}
      onClick={handleExport}
      disabled={disabled || busy || pending}
    >
      <DownloadIcon />
      {busy || pending ? "내보내는 중" : "CSV 내보내기"}
    </button>
  );
}
