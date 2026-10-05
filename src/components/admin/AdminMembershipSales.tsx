"use client";

import { useActionState } from "react";
import { updateProductStatusAction } from "@/app/admin/products/actions";
import type { AdminProduct } from "@/lib/admin/products";
import { membershipPlanDefinitions } from "@/lib/store/membership-plans";
import { formatKrw } from "@/lib/store/pricing";
import { getSaleAvailability, getSaleAvailabilitySummary } from "@/lib/store/sale-availability";
import styles from "./AdminMembershipSales.module.css";

type SaveState = {
  status: "idle" | "success" | "error";
  message: string;
};

const initialSaveState: SaveState = { status: "idle", message: "" };

export default function AdminMembershipSales({
  products,
  databaseReady,
}: {
  products: AdminProduct[];
  databaseReady: boolean;
}) {
  const tiers = membershipPlanDefinitions.map((plan) => ({
    plan,
    product: products.find((product) => product.slug === plan.slug),
  }));
  const summary = getSaleAvailabilitySummary(tiers.map(({ product }) => product?.status));

  return (
    <section className={styles.panel} aria-labelledby="membership-sales-title">
      <header>
        <h2 id="membership-sales-title">SNS 클래스 등급별 판매 관리</h2>
        <p>각 등급의 판매 상태를 따로 저장합니다. 품절이어도 가격과 혜택은 공개되고 해당 등급의 구매만 중단됩니다.</p>
        <p className={styles.summary}>
          {summary === "all_sold_out" ? "세 등급 모두 품절입니다." :
            summary === "unavailable" ? "현재 구매 가능한 등급이 없습니다. 상품별 준비 상태를 확인해 주세요." :
            summary === "mixed" ? "구매 가능한 등급과 구매가 중단된 등급이 함께 있습니다." :
            "세 등급 모두 판매 중입니다."}
        </p>
      </header>
      <div className={styles.grid}>
        {tiers.map(({ plan, product }) => (
          <MembershipSaleControl
            key={plan.slug}
            plan={plan}
            product={product}
            databaseReady={databaseReady}
          />
        ))}
      </div>
    </section>
  );
}

function MembershipSaleControl({
  plan,
  product,
  databaseReady,
}: {
  plan: (typeof membershipPlanDefinitions)[number];
  product: AdminProduct | undefined;
  databaseReady: boolean;
}) {
  const editable = databaseReady && product?.source === "database" && product.productType === "course";
  const title = product?.title ?? plan.title;
  const availability = getSaleAvailability(product?.status);
  const [state, saveAction, pending] = useActionState(
    async (_previous: SaveState, formData: FormData): Promise<SaveState> => {
      const nextStatus = formData.get("status");
      if (!editable || !product || (nextStatus !== "active" && nextStatus !== "sold_out")) {
        return { status: "error", message: "운영 상품과 변경할 상태를 확인해 주세요." };
      }
      try {
        const result = await updateProductStatusAction(product.id, nextStatus);
        return {
          status: result.ok ? "success" : "error",
          message: result.ok ? `저장 완료: ${result.message}` : `저장 실패: ${result.message}`,
        };
      } catch {
        return {
          status: "error",
          message: "저장 결과를 확인하지 못했습니다. 새로고침으로 현재 상태를 확인한 뒤 다시 시도해 주세요.",
        };
      }
    },
    initialSaveState
  );

  return (
    <article className={styles.tier} aria-busy={pending}>
      <h3>{plan.icon} {title}</h3>
      <code>{plan.slug}</code>
      <p className={styles.price}>
        {product ? `${formatKrw(product.priceKrw)}원` : "상품 미등록"}
      </p>
      <p>현재 상태: <strong>{availability.label}</strong></p>
      <form action={saveAction} aria-label={`${title} 판매 상태`}>
        {(["active", "sold_out"] as const).map((status) => (
          <button
            key={status}
            type="submit"
            name="status"
            value={status}
            aria-pressed={product?.status === status}
            disabled={!editable || pending || product?.status === status}
          >
            {status === "active" ? "판매 시작" : "품절로 변경"}
          </button>
        ))}
      </form>
      {!editable && <p className={styles.hint}>{product ? "운영 DB의 강의 상품을 확인해야 변경할 수 있습니다." : "상품을 먼저 등록해 주세요."}</p>}
      {editable && product?.status === "draft" && <p className={styles.hint}>작성 중 상품입니다. 판매 시작 전에 상품 정보와 강의 연결을 확인해 주세요.</p>}
      <p
        className={state.status === "error" ? styles.error : styles.feedback}
        role={state.status === "error" ? "alert" : "status"}
      >
        {pending ? "저장 중…" : state.message}
      </p>
    </article>
  );
}
