import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AccountHeader from "@/components/account/AccountHeader";
import SiteFooter from "@/components/layout/SiteFooter";
import MyOrderHistory from "@/components/my/MyOrderHistory";
import { loadMyOrders } from "@/lib/my-orders/orders";
import { getVerifiedIdentity } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";
import styles from "./orders.module.css";

export const metadata: Metadata = {
  title: "주문 내역 | 이윰 클래스",
  description: "클래스 신청과 결제, 환불 내역을 확인하세요.",
  robots: { index: false, follow: false },
};

export default async function MyOrdersPage() {
  const supabase = await createClient();
  const identity = await getVerifiedIdentity(supabase);

  if (!identity) {
    redirect("/login?next=/my/orders");
  }

  const rawDisplayName =
    identity.metadata.nickname ??
    identity.metadata.name ??
    identity.metadata.full_name;
  const displayName =
    typeof rawDisplayName === "string" && rawDisplayName.trim()
      ? rawDisplayName.trim()
      : "회원";
  const result = await loadMyOrders(supabase);

  return (
    <div className={styles.page}>
      <AccountHeader active="orders" displayName={displayName} />
      <main className={styles.main}>
        <MyOrderHistory
          displayName={displayName}
          orders={result.orders}
          message={result.message}
        />
      </main>
      <SiteFooter variant="compact" />
    </div>
  );
}
