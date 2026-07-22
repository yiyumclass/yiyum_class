"use client";

import { useMemo, useState } from "react";
import type {
  AdminOrder,
  AdminOrderSource,
  AdminOrderStatus,
} from "@/lib/admin/orders";
import styles from "./AdminOrderManager.module.css";

type AdminOrderManagerProps = {
  orders: AdminOrder[];
  databaseReady: boolean;
  sourceMessage: string | null;
  paymentMode: "free" | "toss_test" | "toss_live";
};

type SourceFilter = "all" | AdminOrderSource;
type StatusFilter = "all" | AdminOrderStatus;
type PeriodFilter = "all" | "today" | "7days" | "30days";

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

export default function AdminOrderManager({
  orders,
  databaseReady,
  sourceMessage,
  paymentMode,
}: AdminOrderManagerProps) {
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("all");

  const filteredOrders = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    const periodStart = getPeriodStart(periodFilter);

    return orders.filter((order) => {
      const matchesQuery =
        !normalizedQuery ||
        order.customerName.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
        order.customerEmail.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
        order.productTitle.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
        order.id.toLowerCase().includes(normalizedQuery);
      const matchesSource = sourceFilter === "all" || order.source === sourceFilter;
      const matchesStatus = statusFilter === "all" || order.status === statusFilter;
      const matchesPeriod = !periodStart || new Date(order.createdAt) >= periodStart;

      return matchesQuery && matchesSource && matchesStatus && matchesPeriod;
    });
  }, [orders, periodFilter, query, sourceFilter, statusFilter]);

  const summary = useMemo(() => {
    const todayStart = getPeriodStart("today");
    return {
      total: orders.length,
      today: orders.filter(
        (order) => todayStart && new Date(order.createdAt) >= todayStart
      ).length,
      active: orders.filter((order) => order.status === "active").length,
      revenue: orders.reduce(
        (total, order) => total + (order.status === "active" ? order.amountKrw ?? 0 : 0),
        0
      ),
    };
  }, [orders]);

  return (
    <div className={styles.page}>
      <section className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>ORDERS &amp; PAYMENTS</p>
          <h1>주문 · 결제</h1>
          <p>콘텐츠 신청 유입과 결제 상태, 이용권 발급 결과를 한곳에서 확인합니다.</p>
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
            <code>20260715160000_create_admin_order_ledger.sql</code>
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

      <section className={styles.summaryBar} aria-label="주문 상태 요약">
        <SummaryItem label="전체 신청" value={formatCount(summary.total)} unit="건" />
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
      </section>

      <section className={styles.orderPanel} aria-labelledby="order-list-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="order-list-title">신청 · 주문 내역</h2>
            <p>회원, 상품, 신청 경로와 최종 이용권 상태를 기준으로 조회합니다.</p>
          </div>
          <span className={styles.resultCount}>총 {formatCount(filteredOrders.length)}건</span>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.sourceFilters} aria-label="신청 경로 필터">
            {sourceFilters.map((filter) => (
              <button
                type="button"
                key={filter.value}
                className={sourceFilter === filter.value ? styles.filterActive : styles.filter}
                onClick={() => setSourceFilter(filter.value)}
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
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="회원, 상품 또는 주문번호"
              />
            </label>
            <FilterSelect
              label="조회 기간"
              value={periodFilter}
              options={periodOptions}
              onChange={(value) => setPeriodFilter(value as PeriodFilter)}
            />
            <FilterSelect
              label="이용권 상태"
              value={statusFilter}
              options={statusOptions}
              onChange={(value) => setStatusFilter(value as StatusFilter)}
            />
          </div>
        </div>

        {filteredOrders.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.orderTable}>
              <thead>
                <tr>
                  <th>신청 번호</th>
                  <th>회원</th>
                  <th>상품</th>
                  <th>경로</th>
                  <th>결제 금액</th>
                  <th>이용권</th>
                  <th>신청일</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <OrderRow key={order.id} order={order} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <ReceiptIcon />
            <strong>{orders.length === 0 ? "아직 신청 내역이 없습니다." : "조건에 맞는 내역이 없습니다."}</strong>
            <p>
              {orders.length === 0
                ? "회원이 콘텐츠를 신청하면 이곳에서 바로 확인할 수 있습니다."
                : "검색어 또는 필터 조건을 변경해 보세요."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

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
  tone?: "active";
  note?: string;
}) {
  return (
    <div className={styles.summaryItem}>
      <span>{label}</span>
      <div className={styles.summaryValueGroup}>
        <strong className={tone ? styles.summaryValueActive : undefined}>
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

function OrderRow({ order }: { order: AdminOrder }) {
  return (
    <tr>
      <td data-label="신청 번호">
        <span className={styles.orderId} title={order.id}>
          {formatOrderId(order.id)}
        </span>
      </td>
      <td data-label="회원">
        <span className={styles.customerIdentity}>
          <span className={styles.customerAvatar} aria-hidden="true">
            {order.customerName.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>{order.customerName}</strong>
            <small>{order.customerEmail}</small>
          </span>
        </span>
      </td>
      <td data-label="상품">
        <span className={styles.productCell}>
          <strong>{order.productTitle}</strong>
          <small>{order.productType === "course" ? "VOD 강의" : "전자책"}</small>
        </span>
      </td>
      <td data-label="경로">
        <span className={`${styles.sourceBadge} ${styles[order.source]}`}>
          {formatSource(order.source)}
        </span>
      </td>
      <td data-label="결제 금액" className={styles.priceCell}>
        {order.amountKrw === null ? (
          <span className={styles.unavailableAmount}>연동 대기</span>
        ) : (
          formatPrice(order.amountKrw)
        )}
      </td>
      <td data-label="이용권">
        <span className={`${styles.statusBadge} ${styles[order.status]}`}>
          <span aria-hidden="true" />
          {order.status === "active" ? "이용 가능" : "회수됨"}
        </span>
      </td>
      <td data-label="신청일" className={styles.dateCell}>
        <time dateTime={order.createdAt}>{formatDateTime(order.createdAt)}</time>
        <small>{formatExpiration(order.expiresAt)}</small>
      </td>
    </tr>
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

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="m12.2 12.2 4 4" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m6 8 4 4 4-4" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
    </svg>
  );
}
