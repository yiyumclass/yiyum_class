"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reconcilePaymentOrderAction } from "@/app/admin/orders/actions";
import type { PaymentRecoveryOverview } from "@/lib/admin/payment-recovery";
import styles from "./PaymentRecoveryQueue.module.css";

export default function PaymentRecoveryQueue({ overview }: { overview: PaymentRecoveryOverview }) {
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function recheck(orderId: string) {
    startTransition(async () => {
      try {
        const result = await reconcilePaymentOrderAction(orderId);
        setMessage(result.message);
        router.refresh();
      } catch {
        setMessage("결제 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.");
      }
    });
  }

  return (
    <section className={styles.panel} aria-labelledby="payment-recovery-heading">
      <h2 id="payment-recovery-heading">결제 복구 상태</h2>
      {!overview.available ? (
        <p role="alert">복구 상태를 조회하지 못했습니다. DB 마이그레이션과 결제 모드를 확인해 주세요.</p>
      ) : (
        <>
          <p>처리 대기 {overview.pendingCount}건 · 검토 필요 {overview.reviewCount}건 · 10분 이상 지연 {overview.overdueCount}건</p>
          <p>재확인은 결제사의 현재 상태를 조회해 반영합니다. 추가 결제나 환불은 실행하지 않습니다.</p>
          {overview.items.length > 0 && (
            <ul>
              {overview.items.map((item) => (
                <li key={item.orderId}>
                  <div>
                    <strong>{item.orderUid}</strong>
                    <span>{item.status === "review" ? "검토 필요" : "복구 대기"} · 시도 {item.attempts}회{item.mode === null ? " · 이전 주문 환경 확인 필요" : ""}</span>
                    {item.errorCode && <code>{item.errorCode}</code>}
                  </div>
                  <button type="button" disabled={isPending} onClick={() => recheck(item.orderId)}>
                    {isPending ? "확인 중…" : "결제사 상태 재확인"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {overview.pendingCount + overview.reviewCount > overview.items.length && <p>오래된 작업부터 최대 20건을 표시합니다.</p>}
        </>
      )}
      <p role="status" aria-live="polite">{message}</p>
    </section>
  );
}
