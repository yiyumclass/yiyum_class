import { revalidatePath } from "next/cache";
import { isTossPaymentConfigured } from "@/lib/store/free-enrollment";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Toss 결제 인증 유효시간(30분)의 두 배. 진행 중인 결제를 건드리지 않는다.
const STALE_AFTER_MINUTES = 60;

/**
 * Vercel Cron이 호출한다. 결제창만 열고 이탈해 pending으로 남은 주문을 정리해
 * 마이페이지에 "결제 대기"가 영구히 남지 않게 한다.
 *
 * 승인 흔적(payment_key)이 있는 주문은 RPC가 제외하므로, 이 작업이
 * "돈은 받고 이용권은 못 준" 주문을 가리는 일은 없다.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  if (!isTossPaymentConfigured()) {
    return Response.json({ ok: false, reason: "payment_not_configured" }, { status: 503 });
  }

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("expire_stale_toss_payment_orders", {
    target_older_than_minutes: STALE_AFTER_MINUTES,
  });

  if (error) {
    console.error("Failed to expire stale pending orders:", error.code);
    return Response.json({ ok: false }, { status: 500 });
  }

  const expired = typeof data === "number" ? data : 0;
  if (expired > 0) {
    console.info(`Expired ${expired} stale pending order(s).`);
    revalidatePath("/admin/orders");
    revalidatePath("/my/orders");
  }

  return Response.json({ ok: true, expired }, { status: 200 });
}

/**
 * Vercel Cron은 CRON_SECRET이 설정돼 있으면 Authorization 헤더에 실어 보낸다.
 * 시크릿이 없으면 누구나 호출할 수 있으므로 아예 거절한다.
 */
function isAuthorizedCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET is not configured; refusing to run the cron job.");
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}
