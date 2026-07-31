"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import styles from "./AdminPagination.module.css";

export const ADMIN_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_ADMIN_PAGE_SIZE = 25;

/**
 * 표에 걸린 필터 결과를 페이지 단위로 끊어 보여준다.
 *
 * 현재 목록 조회는 전량을 받아 화면에서 거르는 구조라, 이 컴포넌트는 렌더 비용만
 * 줄인다. 전송량까지 줄이려면 목록 RPC에 range 인자를 추가해야 하며 그 작업은
 * 운영 기록(loadAdminAuditPage)이 쓰는 서버 페이지네이션 패턴을 따르면 된다.
 */
export default function AdminPagination({
  page,
  pageSize,
  totalCount,
  unit = "건",
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  unit?: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const firstRow = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastRow = Math.min(currentPage * pageSize, totalCount);

  if (totalCount <= ADMIN_PAGE_SIZES[0] && pageSize === DEFAULT_ADMIN_PAGE_SIZE) {
    return null;
  }

  return (
    <nav className={styles.pagination} aria-label="표 페이지 이동">
      <p className={styles.range}>
        {totalCount === 0
          ? `0${unit}`
          : `${formatNumber(firstRow)}–${formatNumber(lastRow)} / 총 ${formatNumber(totalCount)}${unit}`}
      </p>

      <div className={styles.controls}>
        <label className={styles.pageSize}>
          <span className={styles.visuallyHidden}>페이지당 행 수</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {ADMIN_PAGE_SIZES.map((size) => (
              <option value={size} key={size}>
                {size}행씩
              </option>
            ))}
          </select>
        </label>

        <div className={styles.pager}>
          <button
            type="button"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label="이전 페이지"
          >
            <ChevronLeftIcon />
          </button>
          <span className={styles.pageState} aria-live="polite">
            {currentPage} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= pageCount}
            aria-label="다음 페이지"
          >
            <ChevronRightIcon />
          </button>
        </div>
      </div>
    </nav>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}
