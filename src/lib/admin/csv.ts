/**
 * 관리자 표를 CSV로 내려받는 유틸.
 *
 * 정산·CS 대응에서 현재 화면에 걸린 필터 그대로를 내보낼 수 있어야 하므로,
 * 서버가 아니라 화면이 보고 있는 행 배열을 그대로 받는다.
 */

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | null | undefined;
};

/** Excel이 한글을 깨뜨리지 않도록 UTF-8 BOM을 붙인다. */
const UTF8_BOM = "﻿";

function escapeCsvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // 앞에 =, +, -, @ 가 오면 스프레드시트가 수식으로 해석한다.
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  if (/["\n\r,]/.test(safeText)) {
    return `"${safeText.replaceAll('"', '""')}"`;
  }
  return safeText;
}

export function buildCsv<T>(columns: Array<CsvColumn<T>>, rows: T[]) {
  const headerLine = columns.map((column) => escapeCsvCell(column.header)).join(",");
  const bodyLines = rows.map((row) =>
    columns.map((column) => escapeCsvCell(column.value(row))).join(",")
  );
  return [headerLine, ...bodyLines].join("\r\n");
}

/**
 * 파일명에 붙일 KST 기준 타임스탬프. 같은 표를 여러 번 받아도 파일이 구분된다.
 */
export function buildCsvTimestamp(now: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}${read("month")}${read("day")}-${read("hour")}${read("minute")}`;
}

export function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob([UTF8_BOM, csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // 일부 브라우저는 클릭 직후 revoke하면 다운로드가 취소된다.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function exportRowsToCsv<T>(options: {
  fileName: string;
  columns: Array<CsvColumn<T>>;
  rows: T[];
}) {
  downloadCsv(
    `${options.fileName}-${buildCsvTimestamp()}.csv`,
    buildCsv(options.columns, options.rows)
  );
}
