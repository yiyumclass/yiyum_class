import type { loadPaymentNotificationOverview } from "@/lib/admin/payment-notifications";
import styles from "./PaymentRecoveryQueue.module.css";

const labels: Record<string, string> = {
  waiting_contact: "연락처 확인 필요",
  unknown: "접수 여부 확인 중 · 재발송 금지",
  review: "수동 확인 필요 · 재발송 금지",
  delivery_failed: "카카오 전달 실패",
  failed: "발송 준비·접수 실패",
};

export default function PaymentNotificationOverview({ overview }: {
  overview: Awaited<ReturnType<typeof loadPaymentNotificationOverview>>;
}) {
  return (
    <section className={styles.panel} aria-labelledby="notification-overview-heading">
      <h2 id="notification-overview-heading">결제 알림톡 상태</h2>
      {!overview.enabled && <p>자동 발송이 비활성화되어 있습니다.</p>}
      {!overview.available ? <p role="alert">알림 상태를 조회하지 못했습니다. DB 마이그레이션을 확인해 주세요.</p> : <>
        <p>수신 완료 {overview.deliveredCount}건 · 처리 중 {overview.pendingCount}건 · 확인 필요 {overview.attentionCount}건</p>
        <p>현재 결제 완료 주문 기준입니다. 접수 성공과 실제 수신 완료를 구분하며, 이 화면에서는 메시지를 발송하지 않습니다.</p>
        {overview.items.length > 0 && <ul>{overview.items.map(item => (
          <li key={item.order_id}><div>
            <strong>{item.orders.order_uid}</strong>
            <span>{labels[item.status] ?? item.status}</span>
            {item.error_code && <code>{item.error_code}</code>}
          </div></li>
        ))}</ul>}
        {overview.items.length === 10 && <p>오래된 확인 대상부터 최대 10건을 표시합니다.</p>}
      </>}
    </section>
  );
}
