"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type MouseEvent,
  type ReactNode,
} from "react";
import { refundPaymentOrderAction } from "@/app/admin/orders/actions";
import {
  describeFulfillmentIssue,
  detectFulfillmentIssue,
} from "@/lib/admin/order-fulfillment";
import type {
  AdminOrder,
  AdminOrderSource,
  AdminOrderStatus,
} from "@/lib/admin/orders";
import { exportRowsToCsv } from "@/lib/admin/csv";
import { useTableParams } from "@/lib/admin/use-table-params";
import AdminDialog from "./AdminDialog";
import { useAdminFeedback } from "./AdminFeedback";
import AdminPagination, { DEFAULT_ADMIN_PAGE_SIZE } from "./AdminPagination";
import {
  ChevronIcon,
  DatabaseIcon,
  DownloadIcon,
  ExternalIcon,
  MemberIcon,
  ChartIcon,
  LayersIcon,
  ReceiptIcon,
  SearchIcon,
  SortIcon,
} from "./icons";
import tableStyles from "./AdminTable.module.css";
import styles from "./AdminOrderManager.module.css";

type AdminOrderManagerProps = {
  orders: AdminOrder[];
  databaseReady: boolean;
  sourceMessage: string | null;
  paymentMode: "free" | "toss_test" | "toss_live";
  canRefund: boolean;
};

type SourceFilter = "all" | AdminOrderSource;
type StatusFilter = "all" | AdminOrderStatus;
type PeriodFilter = "all" | "today" | "7days" | "30days";
type SortKey =
  | "created_desc"
  | "created_asc"
  | "amount_desc"
  | "amount_asc"
  | "progress_desc"
  | "progress_asc";
type SortColumn = "created" | "amount" | "progress";

function fulfillmentIssueOf(order: AdminOrder) {
  return detectFulfillmentIssue({
    source: order.source,
    paymentStatus: order.paymentStatus,
    entitlementStatus: order.status,
    paymentKeyPresent: order.paymentKeyPresent,
    refundStatus: order.refundStatus,
  });
}

const sourceFilters: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "free_checkout", label: "무료 신청" },
  { value: "payment", label: "결제" },
  { value: "admin_grant", label: "관리자 지급" },
];

const statusOptions: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "모든 상태" },
  { value: "active", label: "이용 가능" },
  { value: "revoked", label: "회수됨" },
];

const periodOptions: Array<{ value: PeriodFilter; label: string }> = [
  { value: "all", label: "전체 기간" },
  { value: "today", label: "오늘" },
  { value: "7days", label: "최근 7일" },
  { value: "30days", label: "최근 30일" },
];

// useTableParams는 이 객체를 메모 의존성으로 쓰므로 렌더마다 새로 만들면 안 된다.
const orderTableDefaults = {
  q: "",
  source: "all",
  status: "all",
  period: "all",
  attention: "0",
  sort: "created_desc",
  page: 1,
  size: DEFAULT_ADMIN_PAGE_SIZE,
};

// 금액이 없는 주문(연동 대기)은 0원과 구분해야 하므로 정렬에서 양 끝으로 몬다.
const UNKNOWN_AMOUNT = -1;

const sortComparators: Record<SortKey, (a: AdminOrder, b: AdminOrder) => number> = {
  created_desc: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  created_asc: (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  amount_desc: (a, b) => (b.amountKrw ?? UNKNOWN_AMOUNT) - (a.amountKrw ?? UNKNOWN_AMOUNT),
  amount_asc: (a, b) => (a.amountKrw ?? UNKNOWN_AMOUNT) - (b.amountKrw ?? UNKNOWN_AMOUNT),
  progress_desc: (a, b) => b.learning.progressPercent - a.learning.progressPercent,
  progress_asc: (a, b) => a.learning.progressPercent - b.learning.progressPercent,
};

export default function AdminOrderManager({
  orders,
  databaseReady,
  sourceMessage,
  paymentMode,
  canRefund,
}: AdminOrderManagerProps) {
  const { toast } = useAdminFeedback();
  const { values, setValues, numberOf } = useTableParams(orderTableDefaults);
  const [refundOrder, setRefundOrder] = useState<AdminOrder | null>(null);
  const [detailOrder, setDetailOrder] = useState<AdminOrder | null>(null);

  const sourceFilter = values.source as SourceFilter;
  const statusFilter = values.status as StatusFilter;
  const periodFilter = values.period as PeriodFilter;
  const onlyNeedsAttention = values.attention === "1";
  const sort = (sortComparators[values.sort as SortKey] ? values.sort : "created_desc") as SortKey;
  const page = numberOf("page");
  const pageSize = numberOf("size");

  const searchQuery = values.q;
  const [searchInput, setSearchInput] = useState(searchQuery);
  const committedQuery = useRef(searchQuery);

  // 뒤로가기나 링크 공유로 URL의 q가 바뀌면 입력칸도 따라가야 한다.
  useEffect(() => {
    if (searchQuery === committedQuery.current) return;
    committedQuery.current = searchQuery;
    setSearchInput(searchQuery);
  }, [searchQuery]);

  // 타이핑마다 router.replace를 돌리면 표 전체가 다시 그려진다.
  useEffect(() => {
    if (searchInput === committedQuery.current) return;
    const timer = window.setTimeout(() => {
      committedQuery.current = searchInput;
      setValues({ q: searchInput });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, setValues]);

  const filteredOrders = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase("ko-KR");
    const periodStart = getPeriodStart(periodFilter);

    const matched = orders.filter((order) => {
      if (onlyNeedsAttention && !fulfillmentIssueOf(order)) return false;
      const matchesQuery =
        !normalizedQuery ||
        order.customerName.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
        order.customerEmail.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
        order.productTitle.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
        order.orderUid.toLowerCase().includes(normalizedQuery) ||
        order.id.toLowerCase().includes(normalizedQuery);
      const matchesSource = sourceFilter === "all" || order.source === sourceFilter;
      const matchesStatus = statusFilter === "all" || order.status === statusFilter;
      const matchesPeriod = !periodStart || new Date(order.createdAt) >= periodStart;

      return matchesQuery && matchesSource && matchesStatus && matchesPeriod;
    });

    return matched.sort(sortComparators[sort]);
  }, [
    onlyNeedsAttention,
    orders,
    periodFilter,
    searchQuery,
    sort,
    sourceFilter,
    statusFilter,
  ]);

  // URL로 직접 들어온 범위 밖 페이지 번호가 빈 표를 만들지 않게 잘라 맞춘다.
  const currentPage = Math.min(
    Math.max(1, page),
    Math.max(1, Math.ceil(filteredOrders.length / pageSize))
  );

  const pagedOrders = useMemo(
    () => filteredOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, filteredOrders, pageSize]
  );

  // 이 지표만 전체 기준이다. 필터에 가려 놓친 미이행 주문이 생기면 안 되기 때문이다.
  const needsAttentionCount = useMemo(
    () => orders.filter((order) => fulfillmentIssueOf(order)).length,
    [orders]
  );

  const filterApplied =
    searchQuery.trim().length > 0 ||
    sourceFilter !== "all" ||
    statusFilter !== "all" ||
    periodFilter !== "all" ||
    onlyNeedsAttention;

  // 요약이 항상 전체 누적이면 기간을 좁혀 놓고도 전체 매출을 읽게 된다.
  const summary = useMemo(() => {
    const todayStart = getPeriodStart("today");
    return {
      total: filteredOrders.length,
      today: filteredOrders.filter(
        (order) => todayStart && new Date(order.createdAt) >= todayStart
      ).length,
      active: filteredOrders.filter((order) => order.status === "active").length,
      revenue: filteredOrders.reduce(
        (total, order) =>
          total + (order.paymentStatus === "paid" ? order.amountKrw ?? 0 : 0),
        0
      ),
    };
  }, [filteredOrders]);

  const toggleSort = useCallback(
    (column: SortColumn) => {
      const [descKey, ascKey] = (
        {
          created: ["created_desc", "created_asc"],
          amount: ["amount_desc", "amount_asc"],
          progress: ["progress_desc", "progress_asc"],
        } as const
      )[column];
      setValues({ sort: sort === descKey ? ascKey : descKey });
    },
    [setValues, sort]
  );

  const exportCsv = useCallback(() => {
    exportRowsToCsv({
      fileName: "이윰-주문내역",
      columns: orderCsvColumns,
      rows: filteredOrders,
    });
    toast(`${formatCount(filteredOrders.length)}건을 내보냈습니다.`, "success");
  }, [filteredOrders, toast]);

  const copyValue = useCallback(
    async (label: string, value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        toast(`${label}를 복사했습니다.`, "success");
      } catch (error) {
        console.error("Failed to copy order field:", error);
        toast("복사하지 못했습니다. 값을 직접 선택해 주세요.", "error");
      }
    },
    [toast]
  );

  return (
    <div className={styles.page}>
      <section className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>ORDERS &amp; PAYMENTS</p>
          <h1>주문 · 결제</h1>
            <p>결제 상태와 실제 이용권, 수강 진도와 전액 환불 결과를 한곳에서 확인합니다.</p>
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
            <strong>주문 내역을 아직 불러올 수 없습니다.</strong>
            <p>{sourceMessage}</p>
            <code>주문 원장 및 보유 콘텐츠 RPC 마이그레이션 확인 필요</code>
          </div>
        </div>
      )}

      <div className={styles.modeNotice} role="status">
        <ReceiptIcon />
        <div>
          <strong>
            {paymentMode === "toss_test"
              ? "Toss Payments 테스트 결제가 연결되어 있습니다."
              : paymentMode === "toss_live"
                ? "Toss Payments 실결제가 연결되어 있습니다."
                : "무료 신청 내역을 주문 원장으로 표시합니다."}
          </strong>
          <p>
            {paymentMode === "toss_test"
              ? "테스트 승인 주문도 실제 주문과 동일하게 금액과 이용권 발급 결과가 기록됩니다. 카드에는 청구되지 않습니다."
              : paymentMode === "toss_live"
                ? "승인된 결제 금액과 이용권 발급 결과를 주문 원장에서 확인합니다."
                : "0원 상품 신청과 관리자 지급 내역을 이용권 발급 기준으로 확인합니다."}
          </p>
        </div>
      </div>

      <section className={styles.summarySection} aria-label="주문 상태 요약">
        <div className={styles.summaryCaption}>
          <h2>요약</h2>
          {filterApplied && <span className={styles.filterBadge}>필터 적용됨</span>}
        </div>
        <div className={styles.summaryBar}>
          <SummaryItem label="신청 건수" value={formatCount(summary.total)} unit="건" />
          <SummaryItem label="오늘 신청" value={formatCount(summary.today)} unit="건" />
          <SummaryItem
            label="이용 가능"
            value={formatCount(summary.active)}
            unit="건"
            tone="active"
          />
          <SummaryItem
            label="확인된 결제액"
            value={formatPrice(summary.revenue)}
            note={paymentMode === "toss_test" ? "테스트 승인액" : undefined}
          />
          <SummaryItem
            label="이행 확인 필요 (전체 기준)"
            value={formatCount(needsAttentionCount)}
            unit="건"
            tone={needsAttentionCount > 0 ? "attention" : undefined}
            note={needsAttentionCount > 0 ? "결제 후 이용권 미발급" : undefined}
          />
        </div>
      </section>

      <section className={styles.orderPanel} aria-labelledby="order-list-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="order-list-title">신청 · 주문 내역</h2>
            <p>결제 상태와 이용권 상태를 분리하고 환불 전 수강 기록을 확인합니다.</p>
          </div>
          <div className={styles.panelHeaderActions}>
            <span className={styles.resultCount}>총 {formatCount(filteredOrders.length)}건</span>
            <button
              type="button"
              className={styles.exportButton}
              onClick={exportCsv}
              disabled={filteredOrders.length === 0}
            >
              <DownloadIcon />
              CSV 내보내기
            </button>
          </div>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.sourceFilters} aria-label="신청 경로 필터">
            {sourceFilters.map((filter) => (
              <button
                type="button"
                key={filter.value}
                className={sourceFilter === filter.value ? styles.filterActive : styles.filter}
                onClick={() => setValues({ source: filter.value })}
                aria-pressed={sourceFilter === filter.value}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className={styles.toolbarControls}>
            <label className={styles.searchField}>
              <SearchIcon />
              <span className={styles.visuallyHidden}>주문 검색</span>
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="회원, 상품 또는 주문번호"
              />
            </label>
            <FilterSelect
              label="조회 기간"
              value={periodFilter}
              options={periodOptions}
              onChange={(value) => setValues({ period: value })}
            />
            {/* 0건이어도 필터가 걸려 있으면 해제 수단이 남아 있어야 한다. */}
            {(needsAttentionCount > 0 || onlyNeedsAttention) && (
              <button
                type="button"
                className={
                  onlyNeedsAttention ? styles.attentionFilterActive : styles.attentionFilter
                }
                onClick={() => setValues({ attention: onlyNeedsAttention ? "0" : "1" })}
                aria-pressed={onlyNeedsAttention}
              >
                이행 확인 필요 {formatCount(needsAttentionCount)}건
              </button>
            )}
            <FilterSelect
              label="이용권 상태"
              value={statusFilter}
              options={statusOptions}
              onChange={(value) => setValues({ status: value })}
            />
          </div>
        </div>

        <p className={styles.periodHint}>
          ‘오늘’은 한국 시간 자정부터이고, ‘최근 7일 · 30일’은 지금 이 시각부터 거슬러 세는
          기간입니다.
        </p>

        {filteredOrders.length > 0 ? (
          <>
            <div className={styles.tableWrap}>
              <table className={`${styles.orderTable} ${tableStyles.cardTable}`}>
                <thead>
                  <tr>
                    <th scope="col">신청 번호</th>
                    <th scope="col">회원</th>
                    <th scope="col">상품</th>
                    <th scope="col">경로</th>
                    <SortableHeader
                      label="결제 금액"
                      column="amount"
                      sort={sort}
                      onSort={toggleSort}
                    />
                    <th scope="col">결제 상태</th>
                    <th scope="col">이용권</th>
                    <SortableHeader
                      label="학습 기록"
                      column="progress"
                      sort={sort}
                      onSort={toggleSort}
                    />
                    <SortableHeader
                      label="신청일"
                      column="created"
                      sort={sort}
                      onSort={toggleSort}
                    />
                    <th scope="col">처리</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedOrders.map((order) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      canRefund={canRefund}
                      onRefund={() => setRefundOrder(order)}
                      onOpenDetail={() => setDetailOrder(order)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <AdminPagination
              page={currentPage}
              pageSize={pageSize}
              totalCount={filteredOrders.length}
              onPageChange={(next) => setValues({ page: next })}
              onPageSizeChange={(next) => setValues({ size: next, page: 1 })}
            />
          </>
        ) : (
          <div className={styles.emptyState}>
            <ReceiptIcon />
            <strong>
              {orders.length === 0
                ? "아직 신청 내역이 없습니다."
                : onlyNeedsAttention
                  ? "확인이 필요한 주문이 없습니다."
                  : "조건에 맞는 내역이 없습니다."}
            </strong>
            <p>
              {orders.length === 0
                ? "회원이 콘텐츠를 신청하면 이곳에서 바로 확인할 수 있습니다."
                : onlyNeedsAttention
                  ? "결제가 완료된 주문은 모두 이용권까지 발급됐습니다."
                  : "검색어 또는 필터 조건을 변경해 보세요."}
            </p>
          </div>
        )}
      </section>

      {detailOrder && (
        <OrderDetailDialog
          order={detailOrder}
          canRefund={canRefund}
          onCopy={copyValue}
          onClose={() => setDetailOrder(null)}
          onRefund={() => {
            // 모달이 겹치면 포커스 트랩이 두 겹이 되므로 상세를 먼저 닫는다.
            setDetailOrder(null);
            setRefundOrder(detailOrder);
          }}
        />
      )}

      {refundOrder && (
        <RefundDialog order={refundOrder} onClose={() => setRefundOrder(null)} />
      )}
    </div>
  );
}

const orderCsvColumns = [
  { header: "신청번호", value: (order: AdminOrder) => order.id },
  { header: "주문번호", value: (order: AdminOrder) => order.orderUid },
  { header: "회원명", value: (order: AdminOrder) => order.customerName },
  { header: "이메일", value: (order: AdminOrder) => order.customerEmail },
  { header: "상품명", value: (order: AdminOrder) => order.productTitle },
  {
    header: "상품유형",
    value: (order: AdminOrder) => (order.productType === "course" ? "VOD 강의" : "전자책"),
  },
  { header: "경로", value: (order: AdminOrder) => formatSource(order.source) },
  { header: "결제금액", value: (order: AdminOrder) => order.amountKrw ?? "" },
  {
    header: "결제상태",
    value: (order: AdminOrder) => formatPaymentStatus(order.paymentStatus),
  },
  {
    header: "이용권상태",
    value: (order: AdminOrder) => (order.status === "active" ? "이용 가능" : "회수됨"),
  },
  {
    header: "진도율",
    value: (order: AdminOrder) =>
      order.productType === "course" ? order.learning.progressPercent : "",
  },
  {
    header: "완료차시",
    value: (order: AdminOrder) =>
      order.productType === "course"
        ? `${order.learning.completedLessons}/${order.learning.totalLessons}`
        : "",
  },
  { header: "신청일", value: (order: AdminOrder) => formatDateTime(order.createdAt) },
  {
    header: "승인일",
    value: (order: AdminOrder) => (order.approvedAt ? formatDateTime(order.approvedAt) : ""),
  },
  {
    header: "환불일",
    value: (order: AdminOrder) => (order.refundedAt ? formatDateTime(order.refundedAt) : ""),
  },
  {
    header: "만료일",
    value: (order: AdminOrder) => (order.expiresAt ? formatDateTime(order.expiresAt) : ""),
  },
];

function SummaryItem({
  label,
  value,
  unit,
  tone,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "active" | "attention";
  note?: string;
}) {
  return (
    <div className={styles.summaryItem}>
      <span>{label}</span>
      <div className={styles.summaryValueGroup}>
        <strong
          className={
            tone === "attention"
              ? styles.summaryValueAttention
              : tone === "active"
                ? styles.summaryValueActive
                : undefined
          }
        >
          {value}{unit && <small>{unit}</small>}
        </strong>
        {note && <span className={styles.summaryNote}>{note}</span>}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.selectField}>
      <span className={styles.visuallyHidden}>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronIcon />
    </label>
  );
}

function SortableHeader({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: SortColumn;
  sort: SortKey;
  onSort: (column: SortColumn) => void;
}) {
  const active = sort.startsWith(`${column}_`);
  const ascending = sort === `${column}_asc`;

  return (
    <th scope="col" aria-sort={active ? (ascending ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={active ? styles.sortButtonActive : styles.sortButton}
        onClick={() => onSort(column)}
      >
        {label}
        <SortIcon />
        <span className={styles.visuallyHidden}>
          {active ? (ascending ? "오름차순 정렬됨" : "내림차순 정렬됨") : "정렬하기"}
        </span>
      </button>
    </th>
  );
}

function OrderRow({
  order,
  canRefund,
  onRefund,
  onOpenDetail,
}: {
  order: AdminOrder;
  canRefund: boolean;
  onRefund: () => void;
  onOpenDetail: () => void;
}) {
  const refundAction = getRefundActionState(order, canRefund);
  const fulfillmentIssue = fulfillmentIssueOf(order);

  // 행 전체를 눌러도 열리게 하되, 행 안의 버튼·링크는 각자 동작을 유지해야 한다.
  const stopRowClick = (event: MouseEvent) => event.stopPropagation();

  return (
    <tr
      className={`${styles.clickableRow} ${fulfillmentIssue ? styles.attentionRow : ""}`}
      onClick={onOpenDetail}
    >
      <td>
        <button type="button" className={styles.detailButton} onClick={onOpenDetail}>
          <span className={styles.orderId}>{formatOrderId(order.id)}</span>
          <span className={styles.visuallyHidden}>
            {order.customerName} · {order.productTitle} 상세 보기
          </span>
        </button>
        {fulfillmentIssue && (
          <span
            className={styles.attentionBadge}
            title={describeFulfillmentIssue(fulfillmentIssue)}
          >
            이행 확인 필요
          </span>
        )}
      </td>
      <td data-label="회원">
        <span className={styles.customerIdentity}>
          <span className={styles.customerAvatar} aria-hidden="true">
            {order.customerName.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>{order.customerName}</strong>
            <small>{order.customerEmail}</small>
            <span className={styles.crossLinks}>
              <Link
                href={`/admin/members?q=${encodeURIComponent(order.customerEmail)}`}
                className={styles.crossLink}
                onClick={stopRowClick}
              >
                <MemberIcon />
                회원 정보
              </Link>
              {order.productType === "course" && (
                <Link
                  href={`/admin/progress?q=${encodeURIComponent(order.customerEmail)}`}
                  className={styles.crossLink}
                  onClick={stopRowClick}
                >
                  <ChartIcon />
                  학습 현황
                </Link>
              )}
            </span>
          </span>
        </span>
      </td>
      <td data-label="상품">
        <span className={styles.productCell}>
          <strong>{order.productTitle}</strong>
          <small>{order.productType === "course" ? "VOD 강의" : "전자책"}</small>
          <span className={styles.crossLinks}>
            <Link
              href={`/admin/products?q=${encodeURIComponent(order.productSlug)}`}
              className={styles.crossLink}
              onClick={stopRowClick}
            >
              <LayersIcon />
              상품 정보
            </Link>
          </span>
        </span>
      </td>
      <td data-label="경로">
        <span className={`${styles.sourceBadge} ${styles[order.source]}`}>
          {formatSource(order.source)}
        </span>
      </td>
      <td data-label="결제 금액" className={`${styles.numericCell} ${styles.priceCell}`}>
        {order.amountKrw === null ? (
          <span className={styles.unavailableAmount}>연동 대기</span>
        ) : (
          formatPrice(order.amountKrw)
        )}
      </td>
      <td data-label="결제 상태">
        <span className={`${styles.paymentStatusBadge} ${styles[order.paymentStatus]}`}>
          {formatPaymentStatus(order.paymentStatus)}
        </span>
      </td>
      <td data-label="이용권">
        <span className={`${styles.statusBadge} ${styles[order.status]}`}>
          <span aria-hidden="true" />
          {order.status === "active" ? "이용 가능" : "회수됨"}
        </span>
      </td>
      <td data-label="학습 기록" className={styles.numericCell}>
        {order.productType === "course" ? (
          <span className={styles.learningCell}>
            <strong>{formatProgress(order.learning.progressPercent)}</strong>
            <small>
              시작 {order.learning.startedLessons}/{order.learning.totalLessons} · 완료{" "}
              {order.learning.completedLessons}
            </small>
          </span>
        ) : (
          <span className={styles.unavailableAmount}>해당 없음</span>
        )}
      </td>
      <td data-label="신청일" className={`${styles.numericCell} ${styles.dateCell}`}>
        <time dateTime={order.createdAt}>{formatDateTime(order.createdAt)}</time>
        <small>{formatExpiration(order.expiresAt)}</small>
      </td>
      <td>
        {/* 행마다 내용이 달라도 폭이 같아야 열이 맞는다. 고정 슬롯 하나에 담는다. */}
        <span className={styles.rowActions}>
          {refundAction === "available" || refundAction === "retry" ? (
            <button
              type="button"
              className={styles.refundButton}
              onClick={(event) => {
                stopRowClick(event);
                onRefund();
              }}
            >
              {refundAction === "retry" ? "환불 재시도" : "전액 환불"}
            </button>
          ) : refundAction === "complete" ? (
            <span className={styles.refundedLabel}>
              환불 완료
              {order.refundedAt && <small>{formatDate(order.refundedAt)}</small>}
            </span>
          ) : refundAction === "pending" ? (
            <span className={styles.processingLabel}>환불 처리 중</span>
          ) : (
            <span className={styles.unavailableAmount}>—</span>
          )}
        </span>
      </td>
    </tr>
  );
}

function getRefundActionState(
  order: AdminOrder,
  canRefund: boolean
): "available" | "retry" | "pending" | "complete" | "unavailable" {
  if (order.paymentStatus === "refunded" || order.refundStatus === "succeeded") {
    return "complete";
  }

  if (order.refundStatus === "requested" || order.refundStatus === "processing") {
    return "pending";
  }

  const hasRefundablePayment =
    canRefund &&
    order.source === "payment" &&
    order.paymentStatus === "paid" &&
    order.paymentKeyPresent;

  if (!hasRefundablePayment) return "unavailable";
  return order.refundStatus === "failed" ? "retry" : "available";
}

/**
 * 주문 하나의 전체 기록.
 *
 * 표에는 자리가 없어 잘라낸 값(승인 시각, 환불 기록, 시청 시각, 전체 식별자)을
 * CS 대응에서 그대로 읽고 복사할 수 있게 모아 둔다.
 */
function OrderDetailDialog({
  order,
  canRefund,
  onCopy,
  onClose,
  onRefund,
}: {
  order: AdminOrder;
  canRefund: boolean;
  onCopy: (label: string, value: string) => void;
  onClose: () => void;
  onRefund: () => void;
}) {
  const refundAction = getRefundActionState(order, canRefund);
  const fulfillmentIssue = fulfillmentIssueOf(order);

  return (
    <AdminDialog
      eyebrow="ORDER DETAIL"
      title={`${order.customerName} · ${order.productTitle}`}
      description={`${formatSource(order.source)} · ${formatDateTime(order.createdAt)} 신청`}
      size="large"
      onClose={onClose}
      footer={
        <div className={styles.detailFooter}>
          <div className={styles.crossLinks}>
            <Link
              href={`/admin/members?q=${encodeURIComponent(order.customerEmail)}`}
              className={styles.crossLink}
            >
              <MemberIcon />
              회원 정보
            </Link>
            {order.productType === "course" && (
              <Link
                href={`/admin/progress?q=${encodeURIComponent(order.customerEmail)}`}
                className={styles.crossLink}
              >
                <ChartIcon />
                학습 현황
              </Link>
            )}
            <Link
              href={`/admin/products?q=${encodeURIComponent(order.productSlug)}`}
              className={styles.crossLink}
            >
              <LayersIcon />
              상품 정보
              <ExternalIcon />
            </Link>
          </div>
          {(refundAction === "available" || refundAction === "retry") && (
            <button type="button" className={styles.refundButton} onClick={onRefund}>
              {refundAction === "retry" ? "환불 재시도" : "전액 환불"}
            </button>
          )}
        </div>
      }
    >
      {fulfillmentIssue && (
        <p className={styles.detailIssue} role="note">
          {describeFulfillmentIssue(fulfillmentIssue)}
        </p>
      )}

      <div className={styles.detailIdentifiers}>
        <CopyRow
          label="신청번호"
          value={order.id}
          onCopy={() => onCopy("신청번호", order.id)}
        />
        <CopyRow
          label="주문번호"
          value={order.orderUid}
          onCopy={() => onCopy("주문번호", order.orderUid)}
        />
      </div>

      <DetailSection title="회원 · 상품">
        <DetailRow label="회원" value={order.customerName} />
        <DetailRow label="이메일" value={order.customerEmail} />
        <DetailRow label="상품" value={order.productTitle} />
        <DetailRow
          label="상품 유형"
          value={order.productType === "course" ? "VOD 강의" : "전자책"}
        />
      </DetailSection>

      <DetailSection title="결제">
        <DetailRow label="경로" value={formatSource(order.source)} />
        <DetailRow
          label="결제 상태"
          value={formatPaymentStatus(order.paymentStatus)}
        />
        <DetailRow
          label="결제 금액"
          value={order.amountKrw === null ? "연동 대기" : formatPrice(order.amountKrw)}
        />
        <DetailRow
          label="결제 키"
          value={order.paymentKeyPresent ? "보관됨" : "없음"}
        />
        <DetailRow label="신청 시각" value={formatDateTime(order.createdAt)} />
        <DetailRow
          label="승인 시각"
          value={order.approvedAt ? formatDateTime(order.approvedAt) : "승인 기록 없음"}
        />
      </DetailSection>

      <DetailSection title="이용권 · 환불">
        <DetailRow
          label="이용권 상태"
          value={order.status === "active" ? "이용 가능" : "회수됨"}
        />
        <DetailRow label="이용 기간" value={formatExpiration(order.expiresAt)} />
        <DetailRow
          label="환불 상태"
          value={order.refundStatus ? formatRefundStatus(order.refundStatus) : "환불 기록 없음"}
        />
        <DetailRow
          label="환불 금액"
          value={
            order.refundAmountKrw === null ? "해당 없음" : formatPrice(order.refundAmountKrw)
          }
        />
        <DetailRow
          label="환불 시각"
          value={order.refundedAt ? formatDateTime(order.refundedAt) : "해당 없음"}
        />
      </DetailSection>

      {order.productType === "course" && (
        <DetailSection title="학습 기록">
          <DetailRow label="전체 진도" value={formatProgress(order.learning.progressPercent)} />
          <DetailRow
            label="시작한 강의"
            value={`${order.learning.startedLessons}/${order.learning.totalLessons}`}
          />
          <DetailRow label="완료한 강의" value={`${order.learning.completedLessons}`} />
          <DetailRow
            label="최대 재생 위치 합계"
            value={formatDuration(order.learning.watchedSeconds)}
          />
          <DetailRow
            label="첫 시청"
            value={
              order.learning.firstWatchedAt
                ? formatDateTime(order.learning.firstWatchedAt)
                : "시청 기록 없음"
            }
          />
          <DetailRow
            label="마지막 시청"
            value={
              order.learning.lastWatchedAt
                ? formatDateTime(order.learning.lastWatchedAt)
                : "시청 기록 없음"
            }
          />
        </DetailSection>
      )}
    </AdminDialog>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.detailSection}>
      <h3>{title}</h3>
      <dl className={styles.detailGrid}>{children}</dl>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.detailRow}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function CopyRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className={styles.copyRow}>
      <span>{label}</span>
      <code>{value}</code>
      <button
        type="button"
        className={styles.copyButton}
        onClick={onCopy}
        aria-label={`${label} 복사`}
      >
        복사
      </button>
    </div>
  );
}

function RefundDialog({ order, onClose }: { order: AdminOrder; onClose: () => void }) {
  const { toast } = useAdminFeedback();
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const submitRefund = () => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await refundPaymentOrderAction(order.id, reason);
      setResult(nextResult);
      // 다이얼로그를 닫은 뒤에도 결과가 남아 있어야 재시도 여부를 판단할 수 있다.
      if (nextResult.ok) toast(nextResult.message, "success");
    });
  };

  return (
    <AdminDialog
      eyebrow="FULL REFUND"
      title="전액 환불 확인"
      busy={isPending}
      size="medium"
      onClose={onClose}
      footer={
        <div className={styles.dialogActions}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={onClose}
            disabled={isPending}
          >
            {result?.ok ? "닫기" : "취소"}
          </button>
          {!result?.ok && (
            <button
              type="button"
              className={styles.confirmRefundButton}
              onClick={submitRefund}
              disabled={isPending || reason.trim().length < 3}
            >
              {isPending ? "Toss 환불 처리 중…" : "전액 환불 및 이용권 회수"}
            </button>
          )}
        </div>
      }
    >
      <div className={styles.refundOrderSummary}>
        <div>
          <span>회원</span>
          <strong>{order.customerName}</strong>
          <small>{order.customerEmail}</small>
        </div>
        <div>
          <span>상품</span>
          <strong>{order.productTitle}</strong>
          <small>{order.orderUid}</small>
        </div>
        <div>
          <span>환불 예정액</span>
          <strong>{formatPrice(order.amountKrw ?? 0)}</strong>
          <small>주문 당시 결제금액 전액</small>
        </div>
      </div>

      {order.productType === "course" && (
        <div className={styles.learningEvidence}>
          <div>
            <span>전체 진도</span>
            <strong>{formatProgress(order.learning.progressPercent)}</strong>
          </div>
          <div>
            <span>시작한 강의</span>
            <strong>
              {order.learning.startedLessons}/{order.learning.totalLessons}
            </strong>
          </div>
          <div>
            <span>완료한 강의</span>
            <strong>{order.learning.completedLessons}</strong>
          </div>
          <div>
            <span>최대 재생 위치 합계</span>
            <strong>{formatDuration(order.learning.watchedSeconds)}</strong>
          </div>
        </div>
      )}

      <div className={styles.refundWarning} role="note">
        Toss에서 결제 전액을 취소한 뒤 주문이 환불 완료로 변경되고, 결제로 발급된 이용권이
        즉시 회수됩니다. 이 작업은 되돌릴 수 없습니다.
      </div>

      <label className={styles.refundReasonField}>
        <span>환불 사유</span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={200}
          rows={3}
          placeholder="고객 요청 내용과 환불 판단 근거를 입력해 주세요."
          disabled={isPending || result?.ok}
        />
        <small>{reason.trim().length}/200</small>
      </label>

      {result && (
        <p className={result.ok ? styles.refundSuccess : styles.refundError} role="status">
          {result.message}
        </p>
      )}
    </AdminDialog>
  );
}

// "오늘"은 KST 자정에 맞춘 당일 기준이고, "7일/30일"은 조회 시점부터 거슬러 세는 롤링 윈도우다. 기준이 다른 것은 의도된 설계다.
function getPeriodStart(period: PeriodFilter) {
  if (period === "all") return null;

  const now = new Date();
  if (period === "today") {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const day = Number(parts.find((part) => part.type === "day")?.value);
    return new Date(Date.UTC(year, month - 1, day) - 9 * 60 * 60 * 1000);
  }

  const days = period === "7days" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function formatSource(source: AdminOrderSource) {
  return {
    free_checkout: "무료 신청",
    payment: "결제",
    admin_grant: "관리자 지급",
  }[source];
}

function formatOrderId(id: string) {
  return `#${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatPrice(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
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

function formatExpiration(value: string | null) {
  if (!value) return "이용 기간 무제한";
  return `${new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value))} 만료`;
}

function formatPaymentStatus(status: AdminOrder["paymentStatus"]) {
  return {
    pending: "결제 대기",
    paid: "결제 완료",
    canceled: "승인 전 취소",
    refunded: "환불 완료",
    failed: "결제 실패",
  }[status];
}

function formatRefundStatus(status: NonNullable<AdminOrder["refundStatus"]>) {
  return {
    requested: "환불 요청됨",
    processing: "환불 처리 중",
    succeeded: "환불 완료",
    failed: "환불 실패",
  }[status];
}

function formatProgress(value: number) {
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
