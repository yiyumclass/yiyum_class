import type { Metadata } from "next";
import Link from "next/link";
import {
  AUDIT_TARGET_TYPES,
  isAuditTargetType,
  loadAdminAuditPage,
  type AuditTargetType,
} from "@/lib/admin/audit";
import {
  formatAuditAction,
  formatAuditTarget,
  formatAuditTimestamp,
} from "@/lib/admin/audit-labels";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import styles from "./audit.module.css";

export const metadata: Metadata = {
  title: "운영 기록 | 이윰 관리자",
  robots: { index: false, follow: false },
};

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; target?: string }>;
}) {
  await requireOwnerAdmin();
  const query = await searchParams;

  const targetType: AuditTargetType | null = isAuditTargetType(query.target)
    ? query.target
    : null;
  const requestedPage = Number.parseInt(query.page ?? "1", 10);
  const result = await loadAdminAuditPage({
    page: Number.isFinite(requestedPage) ? requestedPage : 1,
    targetType,
  });

  const buildHref = (next: { page?: number; target?: string | null }) => {
    const params = new URLSearchParams();
    const resolvedTarget = next.target === undefined ? targetType : next.target;
    if (resolvedTarget) params.set("target", resolvedTarget);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const search = params.toString();
    return search ? `/admin/audit?${search}` : "/admin/audit";
  };

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <p className={styles.kicker}>AUDIT LOG</p>
          <h1>운영 기록</h1>
          <p>
            상품·강의·수강권·결제에 대한 모든 변경 기록입니다. 누가 언제 무엇을
            바꿨는지 확인할 수 있습니다.
          </p>
        </div>
        <span className={styles.total}>총 {result.total.toLocaleString("ko-KR")}건</span>
      </header>

      {!result.available ? (
        <p className={styles.notice} role="status">
          운영 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : (
        <>
          <div className={styles.filters} aria-label="대상 필터">
            <Link
              href={buildHref({ target: null, page: 1 })}
              className={targetType === null ? styles.filterActive : styles.filter}
            >
              전체
            </Link>
            {AUDIT_TARGET_TYPES.map((type) => (
              <Link
                key={type}
                href={buildHref({ target: type, page: 1 })}
                className={targetType === type ? styles.filterActive : styles.filter}
              >
                {formatAuditTarget(type)}
              </Link>
            ))}
          </div>

          {result.entries.length > 0 ? (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>일시</th>
                      <th>대상</th>
                      <th>변경 내용</th>
                      <th>식별자</th>
                      <th>수행자</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td data-label="일시">
                          <time dateTime={entry.createdAt}>
                            {formatAuditTimestamp(entry.createdAt)}
                          </time>
                        </td>
                        <td data-label="대상">
                          <span className={styles.targetBadge}>
                            {formatAuditTarget(entry.targetType)}
                          </span>
                        </td>
                        <td data-label="변경 내용">{formatAuditAction(entry.action)}</td>
                        <td data-label="식별자">
                          <span className={styles.targetLabel} title={entry.targetLabel}>
                            {entry.targetLabel}
                          </span>
                        </td>
                        <td data-label="수행자">{entry.actorName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {result.pageCount > 1 && (
                <nav className={styles.pagination} aria-label="페이지 이동">
                  {result.page > 1 ? (
                    <Link href={buildHref({ page: result.page - 1 })}>이전</Link>
                  ) : (
                    <span aria-disabled="true">이전</span>
                  )}
                  <span className={styles.pageState}>
                    {result.page} / {result.pageCount}
                  </span>
                  {result.page < result.pageCount ? (
                    <Link href={buildHref({ page: result.page + 1 })}>다음</Link>
                  ) : (
                    <span aria-disabled="true">다음</span>
                  )}
                </nav>
              )}
            </>
          ) : (
            <p className={styles.notice} role="status">
              {targetType
                ? "이 대상에 대한 기록이 아직 없습니다."
                : "아직 운영 변경 기록이 없습니다."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
