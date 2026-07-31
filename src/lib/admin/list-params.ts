/**
 * 관리자 목록 화면이 URL 쿼리로 주고받는 조회 조건.
 *
 * 이제 거르기·정렬·자르기를 서버가 하므로, searchParams를 그대로 신뢰하면 안 된다.
 * 화면과 SQL 사이에서 값을 한 번 좁혀 두는 자리다. 허용하지 않는 값은 조용히
 * 기본값으로 떨어뜨린다 — 관리자가 URL을 손으로 고쳤다고 화면이 깨질 이유는 없다.
 */

export const ADMIN_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_ADMIN_PAGE_SIZE = 25;

/**
 * CSV로 한 번에 내보낼 수 있는 최대 행. 걸러진 전체를 받아야 쓸모가 있지만,
 * 상한이 없으면 실수 한 번에 서버가 통째로 끌려나온다.
 */
export const ADMIN_EXPORT_LIMIT = 5000;

type SearchParamValue = string | string[] | undefined;

export function readParam(value: SearchParamValue) {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = typeof first === "string" ? first.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export function readOption<T extends string>(
  value: SearchParamValue,
  allowed: readonly T[],
  fallback: T
): T {
  const parsed = readParam(value);
  return parsed && (allowed as readonly string[]).includes(parsed)
    ? (parsed as T)
    : fallback;
}

export function readPage(value: SearchParamValue) {
  const parsed = Number.parseInt(readParam(value) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function readPageSize(value: SearchParamValue) {
  const parsed = Number.parseInt(readParam(value) ?? "", 10);
  return (ADMIN_PAGE_SIZES as readonly number[]).includes(parsed)
    ? parsed
    : DEFAULT_ADMIN_PAGE_SIZE;
}

export function readUuid(value: SearchParamValue) {
  const parsed = readParam(value);
  return parsed && isUuidLike(parsed) ? parsed : null;
}

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** 목록 화면이 공통으로 쓰는 페이지 계산. */
export function resolvePageWindow(page: number, pageSize: number, totalCount: number) {
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  return { pageCount, currentPage, offset: (currentPage - 1) * pageSize };
}

/**
 * "오늘"과 "최근 N일"의 기준이 다르다.
 * 오늘은 KST 자정부터고, 7일·30일은 조회 시점에서 거슬러 세는 롤링 윈도우다.
 * 화면에도 같은 설명을 붙여 둔다.
 */
export function resolvePeriodStart(period: string, now: Date = new Date()) {
  if (period === "today") {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    return new Date(
      Date.UTC(read("year"), read("month") - 1, read("day")) - 9 * 60 * 60 * 1000
    );
  }

  if (period === "7days") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (period === "30days") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return null;
}

/** RPC가 setup 미적용으로 실패했는지, 진짜 장애인지 가른다. */
export function isSetupError(code: string | undefined) {
  return code === "42883" || code === "PGRST202" || code === "PGRST205";
}
