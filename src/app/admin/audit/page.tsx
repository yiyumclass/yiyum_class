import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import AdminAuditCsvButton from "@/components/admin/AdminAuditCsvButton";
import tableStyles from "@/components/admin/AdminTable.module.css";
import {
  AUDIT_PAGE_SIZES,
  AUDIT_TARGET_TYPES,
  COMPACT_AUDIT_PAGE_SIZE,
  loadAdminAuditPage,
  resolveAuditFilters,
  resolveAuditPageSize,
  type AdminAuditFilterInput,
} from "@/lib/admin/audit";
import {
  AUDIT_ACTIONS,
  describeAuditMetadata,
  formatAuditAction,
  formatAuditTarget,
  formatAuditTimestamp,
} from "@/lib/admin/audit-labels";
import { loadManagedAdminUsers } from "@/lib/admin/admin-users";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import styles from "./audit.module.css";

export const metadata: Metadata = {
  title: "운영 기록 | 이윰 관리자",
  robots: { index: false, follow: false },
};

type AuditSearchParams = AdminAuditFilterInput & { page?: string; size?: string };

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<AuditSearchParams>;
}) {
  await requireOwnerAdmin();
  const [query, requestHeaders] = await Promise.all([searchParams, headers()]);

  /*
   * 좁은 화면에서는 기록 한 건이 카드 한 장으로 펼쳐져 25건이면 페이지가 6000px을
   * 넘는다. 서버는 화면 폭을 알 수 없으므로 요청 헤더로 기본값만 정하고, 운영자가
   * 아래 선택지로 언제든 바꿀 수 있게 둔다. 값이 틀려도 보이는 건수만 달라진다.
   */
  const isNarrowClient = /Mobi|Android|iPhone|iPod/i.test(
    requestHeaders.get("user-agent") ?? ""
  );
  const pageSize = resolveAuditPageSize(
    query.size,
    isNarrowClient ? COMPACT_AUDIT_PAGE_SIZE : undefined
  );

  // 화면에 되돌려 줄 값과 실제 조회 조건을 나눈다. 조회 조건은 검증을 통과한 것만
  // 남으므로, 잘못된 값이 들어와도 필터가 조용히 사라진 것처럼 보이지 않게 한다.
  const filterInput: AdminAuditFilterInput = {
    target: query.target,
    action: query.action,
    actor: query.actor,
    from: query.from,
    to: query.to,
  };
  const filters = resolveAuditFilters(filterInput);
  const requestedPage = Number.parseInt(query.page ?? "1", 10);

  const [result, actors] = await Promise.all([
    loadAdminAuditPage({
      ...filters,
      page: Number.isFinite(requestedPage) ? requestedPage : 1,
      pageSize,
    }),
    loadManagedAdminUsers(),
  ]);

  const hasFilter =
    Boolean(filters.targetType) ||
    Boolean(filters.action) ||
    Boolean(filters.actorUserId) ||
    Boolean(filters.from) ||
    Boolean(filters.to);

  // 페이지 이동으로 걸어 둔 조건이 날아가면 사고 조사 중 처음부터 다시 걸어야 한다.
  const buildHref = (next: { page?: number; target?: string | null; size?: number }) => {
    const params = new URLSearchParams();
    const resolvedTarget =
      next.target === undefined ? filters.targetType : next.target;
    if (resolvedTarget) params.set("target", resolvedTarget);
    if (filters.action) params.set("action", filters.action);
    if (filters.actorUserId) params.set("actor", filters.actorUserId);
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
    const resolvedSize = next.size ?? pageSize;
    // 기본값과 같으면 쿼리에 남기지 않는다. 다만 좁은 화면 기본값(10)을 넓은 화면에서
    // 이어받는 일이 없도록, 운영자가 고른 값은 항상 URL에 적는다.
    if (next.size !== undefined || query.size) params.set("size", String(resolvedSize));
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
              className={filters.targetType == null ? styles.filterActive : styles.filter}
            >
              전체
            </Link>
            {AUDIT_TARGET_TYPES.map((type) => (
              <Link
                key={type}
                href={buildHref({ target: type, page: 1 })}
                className={filters.targetType === type ? styles.filterActive : styles.filter}
              >
                {formatAuditTarget(type)}
              </Link>
            ))}
          </div>

          {/* 서버 렌더 화면이라 조건 입력은 GET 폼으로 둔다. 자바스크립트 없이도
              동작하고, 걸어 둔 조건이 그대로 공유 가능한 URL이 된다. */}
          <form className={styles.filterForm} method="get" action="/admin/audit">
            {filters.targetType && (
              <input type="hidden" name="target" value={filters.targetType} />
            )}

            <label className={styles.field}>
              <span>시작일</span>
              <input type="date" name="from" defaultValue={query.from ?? ""} />
            </label>

            <label className={styles.field}>
              <span>종료일</span>
              <input type="date" name="to" defaultValue={query.to ?? ""} />
            </label>

            <label className={styles.field}>
              <span>수행자</span>
              <select name="actor" defaultValue={filters.actorUserId ?? ""}>
                <option value="">전체</option>
                {actors.map((actor) => (
                  <option key={actor.userId} value={actor.userId}>
                    {actor.displayName || actor.email}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>변경 유형</span>
              <select name="action" defaultValue={filters.action ?? ""}>
                <option value="">전체</option>
                {AUDIT_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {formatAuditAction(action)}
                  </option>
                ))}
              </select>
            </label>

            <div className={styles.filterActions}>
              <button type="submit">조건 적용</button>
              {hasFilter && (
                <Link href="/admin/audit" className={styles.resetLink}>
                  초기화
                </Link>
              )}
            </div>
          </form>

          <div className={styles.tableHeader}>
            <p className={styles.tableCaption}>
              {hasFilter ? "조건이 걸린 기록입니다." : "전체 기록입니다."}
            </p>
            <AdminAuditCsvButton
              filters={filterInput}
              disabled={result.total === 0}
              className={styles.csvButton}
            />
          </div>

          {result.entries.length > 0 ? (
            <>
              <div className={styles.tableWrap}>
                <table className={`${styles.table} ${tableStyles.cardTable}`}>
                  <thead>
                    <tr>
                      <th scope="col">일시</th>
                      <th scope="col">대상</th>
                      <th scope="col">변경 내용</th>
                      <th scope="col">식별자</th>
                      <th scope="col">수행자</th>
                      <th scope="col">상세</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.entries.map((entry) => {
                      const details = describeAuditMetadata(entry.metadata);
                      return (
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
                          <td data-label="상세">
                            {details.length > 0 ? (
                              <details className={styles.details}>
                                <summary>{details.length}개 항목</summary>
                                {/* 표 안에 표를 넣으면 좁은 화면 카드 변환 규칙이
                                    중첩 표까지 잡아먹어, 목록으로 같은 정보를 낸다. */}
                                <dl className={styles.detailList}>
                                  {details.map((row) => (
                                    <div key={row.key}>
                                      <dt>{row.label}</dt>
                                      <dd>
                                        {row.before !== null && (
                                          <>
                                            <s>{row.before}</s>
                                            <span aria-hidden="true">→</span>
                                          </>
                                        )}
                                        <span>{row.after}</span>
                                      </dd>
                                    </div>
                                  ))}
                                </dl>
                              </details>
                            ) : (
                              <span className={styles.detailEmpty}>기록 없음</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <nav className={styles.pagination} aria-label="페이지 이동">
                <div className={styles.pageSizes} role="group" aria-label="페이지당 기록 수">
                  {AUDIT_PAGE_SIZES.map((size) => (
                    <Link
                      key={size}
                      href={buildHref({ size, page: 1 })}
                      className={size === pageSize ? styles.pageSizeActive : styles.pageSize}
                      aria-current={size === pageSize ? "true" : undefined}
                    >
                      {size}건
                    </Link>
                  ))}
                </div>

                {result.pageCount > 1 && (
                  <div className={styles.pager}>
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
                  </div>
                )}
              </nav>
            </>
          ) : (
            <p className={styles.notice} role="status">
              {hasFilter
                ? "이 조건에 해당하는 기록이 없습니다."
                : "아직 운영 변경 기록이 없습니다."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
