import Link from "next/link";
import type {
  MyEntitlementStatus,
  MyOrder,
  MyOrderSource,
  MyPaymentStatus,
} from "@/lib/my-orders/orders";
import styles from "@/app/my/orders/orders.module.css";

type MyOrderHistoryProps = {
  displayName: string;
  orders: MyOrder[];
  message: string | null;
};

const paymentStatusLabels: Record<MyPaymentStatus, string> = {
  pending: "결제 대기",
  paid: "결제 완료",
  canceled: "결제 취소",
  refunded: "환불 완료",
  failed: "결제 실패",
};

const sourceLabels: Record<MyOrderSource, string> = {
  payment: "Toss Payments",
  free_checkout: "무료 신청",
  admin_grant: "관리자 지급",
};

const entitlementStatusLabels: Record<MyEntitlementStatus, string> = {
  active: "이용 가능",
  expired: "이용 기간 만료",
  revoked: "이용 종료",
  none: "이용권 없음",
};

export default function MyOrderHistory({
  displayName,
  orders,
  message,
}: MyOrderHistoryProps) {
  const activeCount = orders.filter(
    (order) => order.entitlementStatus === "active"
  ).length;
  const refundedCount = orders.filter(
    (order) => order.paymentStatus === "refunded"
  ).length;

  return (
    <>
      <section className={styles.intro} aria-labelledby="order-history-title">
        <div>
          <span className={styles.eyebrow}>ORDER HISTORY</span>
          <h1 id="order-history-title" className={`serif ${styles.pageTitle}`}>
            {displayName}님의
            <br />주문 내역
          </h1>
        </div>
        <p className={styles.introCopy}>
          클래스 신청과 결제, 환불 기록을 확인할 수 있어요.
          <br className={styles.desktopBreak} /> 수강 가능한 콘텐츠는 마이 클래스에서 확인해 주세요.
        </p>
      </section>

      <section className={styles.summary} aria-label="주문 요약">
        <SummaryItem label="전체 주문" value={orders.length} />
        <SummaryItem label="이용 가능" value={activeCount} />
        <SummaryItem label="환불 완료" value={refundedCount} />
      </section>

      <section className={styles.historySection} aria-labelledby="history-list-title">
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.sectionNumber}>01</span>
            <h2 id="history-list-title" className={`serif ${styles.sectionTitle}`}>
              결제 · 신청 기록
            </h2>
          </div>
          <span className={styles.orderCount}>총 {orders.length}건</span>
        </div>

        {message ? (
          <div className={styles.notice} role="status">
            <strong>주문 내역을 표시할 수 없어요</strong>
            <p>{message}</p>
          </div>
        ) : orders.length === 0 ? (
          <div className={styles.emptyState}>
            <span aria-hidden="true">+</span>
            <h3 className="serif">아직 주문 내역이 없어요</h3>
            <p>클래스를 신청하거나 결제하면 이곳에 기록이 표시됩니다.</p>
            <Link href="/courses">클래스 둘러보기</Link>
          </div>
        ) : (
          <div className={styles.orderList}>
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.summaryItem}>
      <span>{label}</span>
      <strong className="serif">
        {value}
        <small>건</small>
      </strong>
    </div>
  );
}

function OrderCard({ order }: { order: MyOrder }) {
  const status = resolveVisibleStatus(order);
  const productHref =
    order.productType === "course" ? `/courses/${order.productSlug}` : null;

  return (
    <article className={styles.orderCard}>
      <div className={styles.orderLead}>
        <div className={styles.orderDate}>
          <span>{formatDate(order.orderedAt)}</span>
          <small>{order.orderUid}</small>
        </div>
        <span className={`${styles.statusBadge} ${styles[status.tone]}`}>
          {status.label}
        </span>
      </div>

      <div className={styles.productRow}>
        <div className={styles.productMark} aria-hidden="true">
          <span>{order.productType === "course" ? "VOD" : "PDF"}</span>
          <strong>Y</strong>
        </div>
        <div className={styles.productCopy}>
          <span>{order.productType === "course" ? "VOD 클래스" : "전자책"}</span>
          <h3 className="serif">{order.productTitle}</h3>
          <p>
            {sourceLabels[order.source]} · {formatAmount(order.amountKrw)}
          </p>
        </div>
        <div className={styles.amountBlock}>
          <span>결제 금액</span>
          <strong>{formatAmount(order.amountKrw)}</strong>
        </div>
      </div>

      <details className={styles.details}>
        <summary>
          주문 상세
          <ChevronIcon />
        </summary>
        <div className={styles.detailBody}>
          <dl className={styles.detailGrid}>
            <Detail label="주문번호" value={order.orderUid} />
            <Detail label="결제 구분" value={sourceLabels[order.source]} />
            <Detail label="주문일시" value={formatDateTime(order.orderedAt)} />
            <Detail
              label="승인일시"
              value={order.approvedAt ? formatDateTime(order.approvedAt) : "-"}
            />
            <Detail
              label="이용 상태"
              value={entitlementStatusLabels[order.entitlementStatus]}
            />
            <Detail
              label="이용 기한"
              value={formatAccessExpiry(order.expiresAt)}
            />
            {order.refundedAt && (
              <Detail label="환불일시" value={formatDateTime(order.refundedAt)} />
            )}
            {order.refundAmountKrw !== null && (
              <Detail
                label="환불 금액"
                value={formatAmount(order.refundAmountKrw)}
              />
            )}
          </dl>

          <div className={styles.detailActions}>
            {productHref && order.entitlementStatus === "active" && (
              <Link href="/my">마이 클래스에서 학습하기</Link>
            )}
            <Link href="/terms#refund-policy">환불 정책 확인</Link>
          </div>
        </div>
      </details>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function resolveVisibleStatus(order: MyOrder): {
  label: string;
  tone: "statusPaid" | "statusPending" | "statusMuted" | "statusRefunded";
} {
  if (order.refundStatus === "requested" || order.refundStatus === "processing") {
    return { label: "환불 처리 중", tone: "statusPending" };
  }
  if (order.paymentStatus === "refunded") {
    return { label: paymentStatusLabels.refunded, tone: "statusRefunded" };
  }
  if (order.paymentStatus === "paid") {
    if (order.source === "free_checkout") {
      return { label: "신청 완료", tone: "statusPaid" };
    }
    if (order.source === "admin_grant") {
      return { label: "지급 완료", tone: "statusPaid" };
    }
    return { label: paymentStatusLabels.paid, tone: "statusPaid" };
  }
  if (order.paymentStatus === "pending") {
    return { label: paymentStatusLabels.pending, tone: "statusPending" };
  }
  return { label: paymentStatusLabels[order.paymentStatus], tone: "statusMuted" };
}

function formatAmount(value: number) {
  if (value === 0) return "무료";
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
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
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatAccessExpiry(value: string | null) {
  return value ? `${formatDate(value)}까지` : "기간 제한 없음";
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m7 9 5 5 5-5" />
    </svg>
  );
}
