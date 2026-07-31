"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  grantMemberEntitlementAction,
  updateMemberEntitlementAction,
} from "@/app/admin/members/actions";
import AdminDialog from "@/components/admin/AdminDialog";
import { useAdminFeedback } from "@/components/admin/AdminFeedback";
import AdminPagination, {
  DEFAULT_ADMIN_PAGE_SIZE,
} from "@/components/admin/AdminPagination";
import tableStyles from "@/components/admin/AdminTable.module.css";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BookIcon,
  DatabaseIcon,
  DownloadIcon,
  ExternalIcon,
  MemberIcon,
  PlayIcon,
  SearchIcon,
  SortIcon,
} from "@/components/admin/icons";
import { exportRowsToCsv } from "@/lib/admin/csv";
import type {
  AdminEntitlementStatus,
  AdminMember,
  AdminMemberEntitlement,
  AdminMemberProductOption,
} from "@/lib/admin/members";
import { useTableParams } from "@/lib/admin/use-table-params";
import styles from "./AdminMemberManager.module.css";

type AdminMemberManagerProps = {
  members: AdminMember[];
  products: AdminMemberProductOption[];
  databaseReady: boolean;
  sourceMessage: string | null;
  referenceTime: string;
  canManageEntitlements: boolean;
};

type MemberFilter = "all" | "entitled" | "unentitled" | "expiring";
type ExpiryMode = "product" | "unlimited" | "custom";
type SortKey = "joined" | "name" | "active" | "signin";
type SortDirection = "asc" | "desc";

/** 표에 뿌리기 전에 한 번만 계산해 두는 회원별 파생값. */
type MemberRowData = {
  member: AdminMember;
  activeEntitlements: AdminMemberEntitlement[];
  hasExpiring: boolean;
};

const memberFilters: Array<{ value: MemberFilter; label: string }> = [
  { value: "all", label: "전체 회원" },
  { value: "entitled", label: "수강권 보유" },
  { value: "unentitled", label: "미보유" },
  { value: "expiring", label: "30일 내 만료" },
];

/** 정렬 버튼을 처음 누를 때의 방향. 날짜·개수는 큰 값부터 보는 편이 쓸모 있다. */
const defaultSortDirection: Record<SortKey, SortDirection> = {
  joined: "desc",
  name: "asc",
  active: "desc",
  signin: "desc",
};

const DEFAULT_SORT = "joined_desc";

const memberTableDefaults = {
  q: "",
  filter: "all",
  sort: DEFAULT_SORT,
  page: 1,
  size: DEFAULT_ADMIN_PAGE_SIZE,
};

export default function AdminMemberManager({
  members,
  products,
  databaseReady,
  sourceMessage,
  referenceTime,
  canManageEntitlements,
}: AdminMemberManagerProps) {
  const { toast } = useAdminFeedback();
  const { values, setValues, numberOf } = useTableParams(memberTableDefaults);
  const [searchInput, setSearchInput] = useState(values.q);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const query = values.q;
  const filter = toMemberFilter(values.filter);
  const { sortKey, sortDirection } = parseSort(values.sort);
  const page = numberOf("page");
  const pageSize = numberOf("size");

  const selectedMember = members.find((member) => member.id === selectedMemberId) ?? null;
  const canOpenEntitlementManager = databaseReady && canManageEntitlements;
  const referenceDate = useMemo(() => new Date(referenceTime), [referenceTime]);

  // 검색은 타이핑마다 router.replace를 돌리면 무거우므로 입력만 로컬로 받는다.
  useEffect(() => {
    if (searchInput === query) return;
    const timer = window.setTimeout(() => setValues({ q: searchInput }), 300);
    return () => window.clearTimeout(timer);
  }, [query, searchInput, setValues]);

  const rows = useMemo<MemberRowData[]>(
    () =>
      members.map((member) => {
        const activeEntitlements = member.entitlements.filter((entitlement) =>
          isEffectivelyActive(entitlement, referenceDate)
        );
        return {
          member,
          activeEntitlements,
          hasExpiring: activeEntitlements.some((entitlement) =>
            isExpiringSoon(entitlement, referenceDate)
          ),
        };
      }),
    [members, referenceDate]
  );

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");

    return rows.filter((row) => {
      const { member, activeEntitlements, hasExpiring } = row;
      const matchesQuery =
        !normalizedQuery ||
        member.name.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
        member.email.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
        member.id.toLowerCase().includes(normalizedQuery);
      const matchesFilter =
        filter === "all" ||
        (filter === "entitled" && activeEntitlements.length > 0) ||
        (filter === "unentitled" && activeEntitlements.length === 0) ||
        (filter === "expiring" && hasExpiring);

      return matchesQuery && matchesFilter;
    });
  }, [filter, query, rows]);

  const sortedRows = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filteredRows].sort((left, right) => {
      const gap = compareRows(left, right, sortKey);
      // 값이 같으면 이름으로 묶어 페이지 사이에서 순서가 흔들리지 않게 한다.
      if (gap !== 0) return gap * direction;
      return left.member.name.localeCompare(right.member.name, "ko-KR");
    });
  }, [filteredRows, sortDirection, sortKey]);

  // 필터를 좁히면 URL에 남아 있던 페이지 번호가 범위를 넘어 빈 표가 보일 수 있다.
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const pagedRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const isFiltered = filter !== "all" || query.trim().length > 0;

  // 요약은 표와 같은 조건을 봐야 한다. 필터를 걸어둔 채 전체 수치를 보면 오독한다.
  const summary = useMemo(() => {
    const activeEntitlements = filteredRows.flatMap((row) => row.activeEntitlements);
    const thirtyDaysAgo = new Date(referenceDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    return {
      members: filteredRows.length,
      active: activeEntitlements.length,
      newMembers: filteredRows.filter(
        (row) => new Date(row.member.joinedAt) >= thirtyDaysAgo
      ).length,
      expiring: activeEntitlements.filter((entitlement) =>
        isExpiringSoon(entitlement, referenceDate)
      ).length,
    };
  }, [filteredRows, referenceDate]);

  const runMutation = async (mutation: () => Promise<{ ok: boolean; message: string }>) => {
    setPending(true);
    try {
      const result = await mutation();
      toast(result.message, result.ok ? "success" : "error");
      return result.ok;
    } catch {
      toast(
        "요청을 처리하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.",
        "error"
      );
      return false;
    } finally {
      setPending(false);
    }
  };

  const copyMemberId = async (member: AdminMember) => {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(member.id);
      toast("회원 ID를 복사했습니다.", "success");
    } catch {
      toast(
        "회원 ID를 복사하지 못했습니다. 표시된 ID를 직접 선택해 복사해 주세요.",
        "error"
      );
    }
  };

  const exportCsv = () => {
    exportRowsToCsv({
      fileName: "이윰-회원수강권",
      columns: [
        { header: "회원 ID", value: (row: MemberRowData) => row.member.id },
        { header: "이름", value: (row: MemberRowData) => row.member.name },
        { header: "이메일", value: (row: MemberRowData) => row.member.email },
        { header: "가입일", value: (row: MemberRowData) => formatDate(row.member.joinedAt) },
        {
          header: "최근 로그인",
          value: (row: MemberRowData) =>
            row.member.lastSignInAt ? formatDateTime(row.member.lastSignInAt) : "기록 없음",
        },
        {
          header: "활성 수강권 수",
          value: (row: MemberRowData) => row.activeEntitlements.length,
        },
        {
          header: "보유 콘텐츠",
          value: (row: MemberRowData) =>
            row.activeEntitlements.map((entitlement) => entitlement.productTitle).join(";"),
        },
        { header: "만료 예정", value: (row: MemberRowData) => (row.hasExpiring ? "Y" : "N") },
      ],
      rows: sortedRows,
    });
    toast(`${formatNumber(sortedRows.length)}건을 내보냈습니다.`, "success");
  };

  const toggleSort = (key: SortKey) => {
    const next =
      sortKey === key
        ? `${key}_${sortDirection === "asc" ? "desc" : "asc"}`
        : `${key}_${defaultSortDirection[key]}`;
    setValues({ sort: next });
  };

  const ariaSortFor = (key: SortKey) =>
    sortKey !== key ? "none" : sortDirection === "asc" ? "ascending" : "descending";

  return (
    <div className={styles.page}>
      <section className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>MEMBERS &amp; ENTITLEMENTS</p>
          <h1>회원 · 수강권</h1>
          <p>
            {canManageEntitlements
              ? "회원별 보유 콘텐츠와 이용 기간을 확인하고 수강권을 안전하게 운영합니다."
              : "회원별 보유 콘텐츠와 이용 기간을 확인합니다."}
          </p>
        </div>
        <span className={databaseReady ? styles.liveBadge : styles.pendingBadge}>
          <span aria-hidden="true" />
          {databaseReady ? "운영 데이터" : "설정 필요"}
        </span>
      </section>

      {!databaseReady && (
        <div className={styles.setupNotice} role="status">
          <DatabaseIcon />
          <div>
            <strong>회원·수강권 정보를 아직 관리할 수 없습니다.</strong>
            <p>{sourceMessage}</p>
            <code>20260715170000_create_admin_member_entitlements.sql</code>
          </div>
        </div>
      )}

      <section className={styles.summarySection} aria-label="회원과 수강권 요약">
        {isFiltered && <p className={styles.summaryScope}>지금 걸린 조건 기준입니다 (필터 적용됨)</p>}
        <div className={styles.summaryBar}>
          <SummaryItem
            label={isFiltered ? "조회된 회원" : "전체 회원"}
            value={summary.members}
            unit="명"
          />
          <SummaryItem label="활성 수강권" value={summary.active} unit="개" tone="active" />
          <SummaryItem label="최근 30일 가입" value={summary.newMembers} unit="명" />
          <SummaryItem label="30일 내 만료" value={summary.expiring} unit="개" tone="warning" />
        </div>
      </section>

      <section className={styles.memberPanel} aria-labelledby="member-list-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="member-list-title">회원 목록</h2>
            <p>콘텐츠 접근은 로그인 여부가 아닌 유효한 수강권을 기준으로 합니다.</p>
          </div>
          <div className={styles.panelHeaderActions}>
            <span className={styles.resultCount}>총 {formatNumber(sortedRows.length)}명</span>
            <button
              type="button"
              className={styles.exportButton}
              onClick={exportCsv}
              disabled={sortedRows.length === 0}
            >
              <DownloadIcon />
              CSV 내보내기
            </button>
          </div>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.memberFilters} aria-label="회원 필터">
            {memberFilters.map((item) => (
              <button
                type="button"
                key={item.value}
                className={filter === item.value ? styles.filterActive : styles.filter}
                onClick={() => setValues({ filter: item.value })}
                aria-pressed={filter === item.value}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className={styles.searchField}>
            <SearchIcon />
            <span className={styles.visuallyHidden}>회원 검색</span>
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="이름, 이메일 또는 회원 ID"
            />
          </label>
        </div>

        {sortedRows.length > 0 ? (
          <>
            <div className={styles.tableWrap}>
              <table className={`${styles.memberTable} ${tableStyles.cardTable}`}>
                <thead>
                  <tr>
                    <th scope="col" aria-sort={ariaSortFor("name")}>
                      <SortButton
                        label="회원"
                        active={sortKey === "name"}
                        direction={sortDirection}
                        onClick={() => toggleSort("name")}
                      />
                    </th>
                    <th scope="col" aria-sort={ariaSortFor("joined")}>
                      <SortButton
                        label="가입일"
                        active={sortKey === "joined"}
                        direction={sortDirection}
                        onClick={() => toggleSort("joined")}
                      />
                    </th>
                    <th scope="col">보유 콘텐츠</th>
                    <th scope="col" aria-sort={ariaSortFor("active")}>
                      <SortButton
                        label="활성 수강권"
                        active={sortKey === "active"}
                        direction={sortDirection}
                        onClick={() => toggleSort("active")}
                      />
                    </th>
                    <th scope="col" aria-sort={ariaSortFor("signin")}>
                      <SortButton
                        label="최근 로그인"
                        active={sortKey === "signin"}
                        direction={sortDirection}
                        onClick={() => toggleSort("signin")}
                      />
                    </th>
                    <th scope="col">
                      <span className={styles.visuallyHidden}>회원 작업</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row) => (
                    <MemberRow
                      key={row.member.id}
                      row={row}
                      canManage={canOpenEntitlementManager}
                      onManage={() => setSelectedMemberId(row.member.id)}
                      onCopyId={() => copyMemberId(row.member)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <AdminPagination
              page={currentPage}
              pageSize={pageSize}
              totalCount={sortedRows.length}
              unit="명"
              onPageChange={(next) => setValues({ page: next })}
              onPageSizeChange={(next) => setValues({ size: next, page: 1 })}
            />
          </>
        ) : (
          <div className={styles.emptyState}>
            <MemberIcon />
            <strong>
              {members.length === 0
                ? "아직 가입한 회원이 없습니다."
                : "조건에 맞는 회원이 없습니다."}
            </strong>
            <p>
              {members.length === 0
                ? "회원 가입이 완료되면 이곳에서 확인할 수 있습니다."
                : "검색어 또는 필터를 변경해 보세요."}
            </p>
          </div>
        )}
      </section>

      {selectedMember && canOpenEntitlementManager && (
        <EntitlementDialog
          member={selectedMember}
          products={products}
          pending={pending}
          referenceDate={referenceDate}
          onClose={() => setSelectedMemberId(null)}
          onCopyId={() => copyMemberId(selectedMember)}
          onGrant={(productId, expiresAt) =>
            runMutation(() =>
              grantMemberEntitlementAction(selectedMember.id, productId, expiresAt)
            )
          }
          onUpdate={(entitlementId, status, expiresAt) =>
            runMutation(() => updateMemberEntitlementAction(entitlementId, status, expiresAt))
          }
        />
      )}
    </div>
  );
}

function SummaryItem({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: number;
  unit: string;
  tone?: "active" | "warning";
}) {
  return (
    <div className={styles.summaryItem}>
      <span>{label}</span>
      <strong className={tone ? styles[`summaryValue_${tone}`] : undefined}>
        {formatNumber(value)}
        <small>{unit}</small>
      </strong>
    </div>
  );
}

function SortButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? styles.sortButtonActive : styles.sortButton}
      onClick={onClick}
    >
      {label}
      {active ? direction === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon /> : <SortIcon />}
    </button>
  );
}

function MemberRow({
  row,
  canManage,
  onManage,
  onCopyId,
}: {
  row: MemberRowData;
  canManage: boolean;
  onManage: () => void;
  onCopyId: () => void;
}) {
  const { member, activeEntitlements } = row;
  return (
    <tr>
      <td>
        <span className={styles.memberIdentity}>
          <span className={styles.memberAvatar} aria-hidden="true">
            {member.name.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>{member.name}</strong>
            <small>{member.email}</small>
            <MemberIdField member={member} onCopy={onCopyId} />
          </span>
        </span>
      </td>
      <td data-label="가입일" className={`${styles.numericCell} ${styles.dateCell}`}>
        {formatDate(member.joinedAt)}
      </td>
      <td data-label="보유 콘텐츠">
        {activeEntitlements.length > 0 ? (
          <span className={styles.productChips}>
            {activeEntitlements.slice(0, 2).map((entitlement) => (
              <span key={entitlement.id}>{entitlement.productTitle}</span>
            ))}
            {activeEntitlements.length > 2 && <small>+{activeEntitlements.length - 2}</small>}
          </span>
        ) : (
          <span className={styles.emptyValue}>없음</span>
        )}
      </td>
      <td data-label="활성 수강권" className={styles.numericCell}>
        <strong className={activeEntitlements.length > 0 ? styles.activeCount : styles.zeroCount}>
          {activeEntitlements.length}
          <small>개</small>
        </strong>
      </td>
      <td data-label="최근 로그인" className={`${styles.numericCell} ${styles.dateCell}`}>
        {member.lastSignInAt ? formatDateTime(member.lastSignInAt) : "기록 없음"}
      </td>
      <td className={styles.actionCell}>
        <span className={styles.rowActions}>
          <MemberCrossLinks email={member.email} />
          {canManage ? (
            <button type="button" onClick={onManage}>
              수강권 관리
            </button>
          ) : (
            <span className={styles.emptyValue}>조회 전용</span>
          )}
        </span>
      </td>
    </tr>
  );
}

/**
 * 운영자 추가 화면이 회원 UUID를 직접 입력받는데 그동안 UUID를 볼 곳이 없었다.
 * 좁은 화면에서는 앞 8자만 노출하고 복사 버튼으로 전문을 넘긴다.
 */
function MemberIdField({ member, onCopy }: { member: AdminMember; onCopy: () => void }) {
  return (
    <span className={styles.memberIdField}>
      <code title={member.id}>
        <span className={styles.memberIdFull}>{member.id}</span>
        <span className={styles.memberIdShort}>{member.id.slice(0, 8)}</span>
      </code>
      <button
        type="button"
        className={styles.copyIdButton}
        onClick={onCopy}
        aria-label={`${member.name} 회원 ID 복사`}
      >
        복사
      </button>
    </span>
  );
}

/** 회원 → 주문·학습 화면 이동. 이메일을 손으로 옮겨 붙이던 동선을 없앤다. */
function MemberCrossLinks({ email }: { email: string }) {
  const encoded = encodeURIComponent(email);
  return (
    <>
      <Link className={styles.crossLink} href={`/admin/orders?q=${encoded}`}>
        주문 내역
        <ExternalIcon />
      </Link>
      <Link className={styles.crossLink} href={`/admin/progress?q=${encoded}`}>
        학습 현황
        <ExternalIcon />
      </Link>
    </>
  );
}

function EntitlementDialog({
  member,
  products,
  pending,
  referenceDate,
  onClose,
  onCopyId,
  onGrant,
  onUpdate,
}: {
  member: AdminMember;
  products: AdminMemberProductOption[];
  pending: boolean;
  referenceDate: Date;
  onClose: () => void;
  onCopyId: () => void;
  onGrant: (productId: string, expiresAt: string | null) => Promise<boolean>;
  onUpdate: (
    entitlementId: string,
    status: AdminEntitlementStatus,
    expiresAt: string | null
  ) => Promise<boolean>;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>("product");
  const [customExpiry, setCustomExpiry] = useState("");
  const selectedProduct = products.find((product) => product.id === productId);

  // 만료가 임박한 수강권부터 보여야 실무에서 처리 순서를 잡을 수 있다.
  const sortedEntitlements = useMemo(
    () =>
      [...member.entitlements].sort((left, right) => {
        const gap =
          entitlementOrder[getEffectiveStatus(left, referenceDate)] -
          entitlementOrder[getEffectiveStatus(right, referenceDate)];
        if (gap !== 0) return gap;
        return expiryTime(left) - expiryTime(right);
      }),
    [member.entitlements, referenceDate]
  );

  const submitGrant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProduct) return;
    const expiresAt = resolveGrantExpiration(
      selectedProduct,
      expiryMode,
      customExpiry,
      referenceDate
    );
    if (expiryMode === "custom" && !expiresAt) return;
    await onGrant(selectedProduct.id, expiresAt);
  };

  return (
    <AdminDialog
      eyebrow="MEMBER ACCESS"
      title={`${member.name}님의 수강권`}
      description={member.email}
      busy={pending}
      size="large"
      onClose={onClose}
    >
      <div className={styles.dialogMeta}>
        <span className={styles.memberIdField}>
          <span className={styles.visuallyHidden}>회원 ID</span>
          <code title={member.id}>
            <span className={styles.memberIdFull}>{member.id}</span>
            <span className={styles.memberIdShort}>{member.id.slice(0, 8)}</span>
          </code>
          <button
            type="button"
            className={styles.copyIdButton}
            onClick={onCopyId}
            aria-label="회원 ID 복사"
          >
            복사
          </button>
        </span>
        <span className={styles.dialogLinks}>
          <MemberCrossLinks email={member.email} />
        </span>
      </div>

      <div className={styles.dialogBody}>
        <section className={styles.entitlementSection} aria-labelledby="current-entitlements-title">
          <div className={styles.dialogSectionHeading}>
            <h3 id="current-entitlements-title">보유 수강권</h3>
            <span>{member.entitlements.length}개</span>
          </div>
          {sortedEntitlements.length > 0 ? (
            <div className={styles.entitlementList}>
              {sortedEntitlements.map((entitlement) => (
                <EntitlementEditor
                  key={`${entitlement.id}:${entitlement.status}:${entitlement.expiresAt ?? "none"}`}
                  entitlement={entitlement}
                  pending={pending}
                  referenceDate={referenceDate}
                  onUpdate={onUpdate}
                />
              ))}
            </div>
          ) : (
            <div className={styles.dialogEmpty}>아직 지급된 수강권이 없습니다.</div>
          )}
        </section>

        <form className={styles.grantForm} onSubmit={submitGrant}>
          <div className={styles.dialogSectionHeading}>
            <h3>새 수강권 지급</h3>
            <span>관리자 지급</span>
          </div>
          <label>
            <span>상품</span>
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              required
            >
              {products.map((product) => (
                <option value={product.id} key={product.id}>
                  {product.title} · {formatProductStatus(product.status)}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>이용 기간</legend>
            <label>
              <input
                type="radio"
                name="expiryMode"
                value="product"
                checked={expiryMode === "product"}
                onChange={() => setExpiryMode("product")}
              />
              상품 기본값 (
              {selectedProduct?.accessPeriodDays
                ? `${selectedProduct.accessPeriodDays}일`
                : "무제한"}
              )
            </label>
            <label>
              <input
                type="radio"
                name="expiryMode"
                value="unlimited"
                checked={expiryMode === "unlimited"}
                onChange={() => setExpiryMode("unlimited")}
              />
              기간 제한 없음
            </label>
            <label>
              <input
                type="radio"
                name="expiryMode"
                value="custom"
                checked={expiryMode === "custom"}
                onChange={() => setExpiryMode("custom")}
              />
              만료일 직접 선택
            </label>
          </fieldset>
          {expiryMode === "custom" && (
            <label>
              <span>만료일</span>
              <input
                type="date"
                value={customExpiry}
                min={getTomorrowDate(referenceDate)}
                onChange={(event) => setCustomExpiry(event.target.value)}
                required
              />
              <QuickExpiryButtons
                referenceDate={referenceDate}
                disabled={pending}
                onSelect={setCustomExpiry}
              />
            </label>
          )}
          <button
            type="submit"
            className={styles.grantButton}
            disabled={pending || !selectedProduct}
          >
            {pending ? "처리 중" : "수강권 지급"}
          </button>
        </form>
      </div>
    </AdminDialog>
  );
}

/** 만료일을 손으로 고르는 대신 자주 쓰는 기간을 서버 시각 기준으로 채워 넣는다. */
function QuickExpiryButtons({
  referenceDate,
  disabled,
  onSelect,
}: {
  referenceDate: Date;
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <span className={styles.quickExpiry}>
      {[30, 90].map((days) => (
        <button
          key={days}
          type="button"
          disabled={disabled}
          title={`오늘부터 ${days}일 뒤로 만료일을 설정합니다.`}
          onClick={() => onSelect(addDaysToDateInput(referenceDate, days))}
        >
          {days}일 연장
        </button>
      ))}
    </span>
  );
}

function EntitlementEditor({
  entitlement,
  pending,
  referenceDate,
  onUpdate,
}: {
  entitlement: AdminMemberEntitlement;
  pending: boolean;
  referenceDate: Date;
  onUpdate: (
    entitlementId: string,
    status: AdminEntitlementStatus,
    expiresAt: string | null
  ) => Promise<boolean>;
}) {
  const { confirm } = useAdminFeedback();
  const effectiveStatus = getEffectiveStatus(entitlement, referenceDate);
  // 이미 만료된 수강권은 과거 만료일을 그대로 되보내면 서버·DB가 거부하므로, 편집 초기값을 무제한("")으로 둔다.
  const [expiration, setExpiration] = useState(
    effectiveStatus === "expired" ? "" : toDateInputValue(entitlement.expiresAt)
  );
  const [expirationError, setExpirationError] = useState<string | null>(null);

  const updateStatus = async (status: AdminEntitlementStatus) => {
    if (status === "revoked") {
      const confirmed = await confirm({
        title: `${entitlement.productTitle} 수강권을 회수할까요?`,
        description: "즉시 콘텐츠 접근이 중단됩니다.\n필요하면 나중에 다시 활성화할 수 있습니다.",
        confirmLabel: "수강권 회수",
        tone: "danger",
      });
      if (!confirmed) return;
    }
    if (expiration && new Date(toEndOfDayIso(expiration)) <= referenceDate) {
      setExpirationError(
        "만료일이 지났습니다. 새 만료일을 지정하거나 비워서 무제한으로 저장해 주세요."
      );
      return;
    }
    setExpirationError(null);
    await onUpdate(entitlement.id, status, expiration ? toEndOfDayIso(expiration) : null);
  };

  return (
    <article className={styles.entitlementCard}>
      <div className={styles.entitlementTop}>
        <span className={styles.productIcon} aria-hidden="true">
          {entitlement.productType === "course" ? <PlayIcon /> : <BookIcon />}
        </span>
        <div>
          <strong>{entitlement.productTitle}</strong>
          <span>
            {formatSource(entitlement.source)} · {formatDate(entitlement.grantedAt)} 지급
          </span>
        </div>
        <span className={`${styles.entitlementBadge} ${styles[effectiveStatus]}`}>
          {formatEffectiveStatus(effectiveStatus)}
        </span>
      </div>
      <div className={styles.entitlementControls}>
        <label>
          <span>만료일</span>
          <input
            type="date"
            value={expiration}
            min={getTomorrowDate(referenceDate)}
            disabled={pending}
            onChange={(event) => {
              setExpiration(event.target.value);
              setExpirationError(null);
            }}
          />
          {expiration && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setExpiration("");
                setExpirationError(null);
              }}
            >
              무제한으로
            </button>
          )}
          <QuickExpiryButtons
            referenceDate={referenceDate}
            disabled={pending}
            onSelect={(value) => {
              setExpiration(value);
              setExpirationError(null);
            }}
          />
          {expirationError && (
            <span className={styles.summaryValue_warning}>{expirationError}</span>
          )}
        </label>
        <span className={styles.entitlementActions}>
          {entitlement.status === "revoked" ? (
            <button type="button" disabled={pending} onClick={() => updateStatus("active")}>
              다시 활성화
            </button>
          ) : (
            <>
              <button type="button" disabled={pending} onClick={() => updateStatus("active")}>
                기간 저장
              </button>
              <button
                type="button"
                className={styles.revokeButton}
                disabled={pending}
                onClick={() => updateStatus("revoked")}
              >
                회수
              </button>
            </>
          )}
        </span>
      </div>
    </article>
  );
}

type EffectiveStatus = "active" | "expiring" | "expired" | "revoked";

const entitlementOrder: Record<EffectiveStatus, number> = {
  expiring: 0,
  active: 1,
  expired: 2,
  revoked: 3,
};

function expiryTime(entitlement: AdminMemberEntitlement) {
  return entitlement.expiresAt
    ? new Date(entitlement.expiresAt).getTime()
    : Number.POSITIVE_INFINITY;
}

function compareRows(left: MemberRowData, right: MemberRowData, key: SortKey) {
  switch (key) {
    case "name":
      return left.member.name.localeCompare(right.member.name, "ko-KR");
    case "active":
      return left.activeEntitlements.length - right.activeEntitlements.length;
    case "signin":
      return signInTime(left.member) - signInTime(right.member);
    default:
      return new Date(left.member.joinedAt).getTime() - new Date(right.member.joinedAt).getTime();
  }
}

/** 로그인 기록이 없는 회원은 항상 가장 오래된 쪽으로 보낸다. */
function signInTime(member: AdminMember) {
  return member.lastSignInAt ? new Date(member.lastSignInAt).getTime() : 0;
}

function toMemberFilter(value: string): MemberFilter {
  return memberFilters.some((item) => item.value === value) ? (value as MemberFilter) : "all";
}

function parseSort(value: string): { sortKey: SortKey; sortDirection: SortDirection } {
  const [key, direction] = value.split("_");
  const sortKey: SortKey =
    key === "name" || key === "active" || key === "signin" || key === "joined" ? key : "joined";
  return {
    sortKey,
    sortDirection: direction === "asc" ? "asc" : "desc",
  };
}

function getEffectiveStatus(
  entitlement: AdminMemberEntitlement,
  referenceDate: Date
): EffectiveStatus {
  if (entitlement.status === "revoked") return "revoked";
  if (!entitlement.expiresAt) return "active";
  const expiresAt = new Date(entitlement.expiresAt);
  if (expiresAt <= referenceDate) return "expired";
  return isExpiringSoon(entitlement, referenceDate) ? "expiring" : "active";
}

function isEffectivelyActive(entitlement: AdminMemberEntitlement, referenceDate: Date) {
  return (
    entitlement.status === "active" &&
    (!entitlement.expiresAt || new Date(entitlement.expiresAt) > referenceDate)
  );
}

function isExpiringSoon(entitlement: AdminMemberEntitlement, referenceDate: Date) {
  if (!entitlement.expiresAt || !isEffectivelyActive(entitlement, referenceDate)) return false;
  return (
    new Date(entitlement.expiresAt).getTime() <=
    referenceDate.getTime() + 30 * 24 * 60 * 60 * 1000
  );
}

/**
 * 상품 기본 기간은 서버가 내려준 referenceDate에서 센다. Date.now()를 쓰면
 * 만료일이 관리자 PC 시계에 따라 달라진다.
 */
function resolveGrantExpiration(
  product: AdminMemberProductOption,
  mode: ExpiryMode,
  customExpiry: string,
  referenceDate: Date
) {
  if (mode === "unlimited") return null;
  if (mode === "custom") return customExpiry ? toEndOfDayIso(customExpiry) : null;
  if (!product.accessPeriodDays) return null;
  return new Date(
    referenceDate.getTime() + product.accessPeriodDays * 24 * 60 * 60 * 1000
  ).toISOString();
}

function toDateInputValue(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function toEndOfDayIso(value: string) {
  return new Date(`${value}T23:59:59+09:00`).toISOString();
}

function getTomorrowDate(referenceDate: Date) {
  return addDaysToDateInput(referenceDate, 1);
}

function addDaysToDateInput(referenceDate: Date, days: number) {
  const target = new Date(referenceDate.getTime() + days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(target);
}

function formatEffectiveStatus(status: EffectiveStatus) {
  return { active: "이용 가능", expiring: "만료 예정", expired: "만료", revoked: "회수됨" }[status];
}

function formatSource(source: AdminMemberEntitlement["source"]) {
  return { free_checkout: "무료 신청", payment: "결제", admin_grant: "관리자 지급" }[source];
}

function formatProductStatus(status: AdminMemberProductOption["status"]) {
  return { active: "판매 중", draft: "작성 중", paused: "판매 중지" }[status];
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
