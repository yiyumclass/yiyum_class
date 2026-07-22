import { revalidatePath } from "next/cache";
import { confirmTossPayment, getTossPayment, type TossPayment } from "@/lib/payments/toss";
import { isTossPaymentConfigured } from "@/lib/store/free-enrollment";
import { getAdminClient } from "@/lib/supabase/admin";
import { getVerifiedIdentity } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ConfirmRequest = {
  paymentKey: string;
  orderId: string;
  amount: number;
};

type OrderRow = {
  id: string;
  order_uid: string;
  product_id: string;
  amount: number;
  source: "free_checkout" | "payment" | "admin_grant";
  status: "pending" | "paid" | "canceled" | "refunded" | "failed";
  payment_key: string | null;
  refund_policy_version: string | null;
  refund_policy_agreed_at: string | null;
};

type EntitlementRow = {
  status: "active" | "revoked";
  expires_at: string | null;
};

type CompletedPaymentRow = {
  product_slug: string;
  product_type: "course" | "ebook";
  expires_at: string | null;
};

export async function POST(request: Request) {
  if (!isTossPaymentConfigured()) {
    return json({ ok: false, message: "결제 서버 설정을 확인하고 있습니다." }, 503);
  }

  const input = await readConfirmRequest(request);
  if (!input) {
    return json({ ok: false, message: "결제 승인 정보를 다시 확인해 주세요." }, 400);
  }

  const supabase = await createClient();
  const identity = await getVerifiedIdentity(supabase);
  if (!identity) {
    return json({ ok: false, message: "로그인 후 결제를 확인해 주세요." }, 401);
  }

  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, order_uid, product_id, amount, source, status, payment_key, refund_policy_version, refund_policy_agreed_at"
    )
    .eq("order_uid", input.orderId)
    .maybeSingle<OrderRow>();

  if (error) {
    console.error("Failed to load Toss payment order:", error.code);
    return json({ ok: false, message: "주문 정보를 확인하지 못했습니다." }, 500);
  }
  if (!data) {
    return json({ ok: false, message: "본인의 결제 주문을 찾지 못했습니다." }, 404);
  }
  if (data.amount !== input.amount) {
    console.error("Rejected Toss payment with an amount mismatch.");
    return json({ ok: false, message: "주문 금액이 일치하지 않습니다." }, 400);
  }
  if (data.source !== "payment") {
    return json({ ok: false, message: "결제 승인 대상 주문이 아닙니다." }, 409);
  }

  if (data.status === "paid") {
    if (data.payment_key !== input.paymentKey) {
      return json({ ok: false, message: "이미 다른 결제로 완료된 주문입니다." }, 409);
    }
    return json({ ok: true, alreadyProcessed: true }, 200);
  }
  if (data.status !== "pending") {
    return json({ ok: false, message: "더 이상 승인할 수 없는 주문입니다." }, 409);
  }
  if (!data.refund_policy_version || !data.refund_policy_agreed_at) {
    return json({ ok: false, message: "환불 정책 동의를 확인하지 못했습니다." }, 409);
  }
  if (data.payment_key !== null && data.payment_key !== input.paymentKey) {
    return json({ ok: false, message: "주문에 등록된 결제 정보와 일치하지 않습니다." }, 409);
  }

  // 주문 생성 후 관리자 지급 등으로 이용권이 생겼다면 외부 승인을 호출하지 않는다.
  const { data: entitlement, error: entitlementError } = await supabase
    .from("product_entitlements")
    .select("status, expires_at")
    .eq("product_id", data.product_id)
    .maybeSingle<EntitlementRow>();
  if (entitlementError) {
    console.error("Failed to recheck entitlement before Toss confirmation:", entitlementError.code);
    return json({ ok: false, message: "이용권 상태를 확인하지 못했습니다." }, 500);
  }
  if (isActiveEntitlement(entitlement)) {
    await supabase.rpc("fail_toss_payment_order", {
      target_order_uid: input.orderId,
    });
    return json({ ok: false, message: "이미 이용 중인 상품이므로 결제를 진행하지 않았습니다." }, 409);
  }

  let tossPayment: TossPayment | null = null;
  const confirmation = await confirmTossPayment(input);

  if (confirmation.ok) {
    tossPayment = confirmation.payment;
  } else {
    // Toss 승인은 성공했지만 내부 DB 반영 전에 연결이 끊긴 경우를 복구한다.
    const lookup = await getTossPayment(input.paymentKey);
    if (lookup.ok && lookup.payment.status === "DONE") {
      tossPayment = lookup.payment;
    } else if (confirmation.retryable) {
      console.error("Toss payment confirmation is temporarily unavailable:", confirmation.code);
      return json(
        { ok: false, retryable: true, message: "결제 승인 확인이 지연되고 있습니다. 잠시 후 다시 확인해 주세요." },
        503
      );
    } else {
      await supabase.rpc("fail_toss_payment_order", {
        target_order_uid: input.orderId,
      });
      return json(
        { ok: false, message: resolveConfirmationFailure(confirmation.code) },
        confirmation.httpStatus >= 400 && confirmation.httpStatus < 500
          ? confirmation.httpStatus
          : 400
      );
    }
  }

  if (!isMatchingCompletedPayment(tossPayment, input)) {
    console.error("Rejected an inconsistent Toss payment response.");
    return json({ ok: false, message: "결제 승인 결과가 주문 정보와 일치하지 않습니다." }, 409);
  }

  const admin = getAdminClient();
  const { error: recoveryRecordError } = await admin
    .from("orders")
    .update({
      payment_key: input.paymentKey,
      approved_at: tossPayment.approvedAt,
    })
    .eq("id", data.id)
    .eq("status", "pending");
  if (recoveryRecordError) {
    console.error("Failed to persist approved Toss payment for recovery:", recoveryRecordError.code);
  }

  const { data: completed, error: completionError } = await admin.rpc(
    "complete_toss_payment_server",
    {
      target_user_id: identity.userId,
      target_order_uid: input.orderId,
      target_payment_key: input.paymentKey,
      target_amount: input.amount,
      target_approved_at: tossPayment.approvedAt,
    }
  );

  if (completionError) {
    console.error("Toss payment was approved but fulfillment failed:", completionError.code);
    return json(
      {
        ok: false,
        retryable: true,
        message: "결제는 승인됐지만 이용권 발급을 확인 중입니다. 이 페이지에서 다시 확인해 주세요.",
      },
      500
    );
  }

  const completedRow = (Array.isArray(completed) ? completed[0] : null) as
    | CompletedPaymentRow
    | null;
  revalidatePath("/my");
  if (completedRow?.product_slug) {
    revalidatePath(`/learn/${completedRow.product_slug}`);
  }

  return json(
    {
      ok: true,
      productSlug: completedRow?.product_slug ?? null,
      expiresAt: completedRow?.expires_at ?? null,
    },
    200
  );
}

async function readConfirmRequest(request: Request): Promise<ConfirmRequest | null> {
  const payload: unknown = await request.json().catch(() => null);
  if (!isRecord(payload)) return null;

  const paymentKey = payload.paymentKey;
  const orderId = payload.orderId;
  const amount = payload.amount;
  if (
    typeof paymentKey !== "string" ||
    paymentKey.length < 1 ||
    paymentKey.length > 200 ||
    typeof orderId !== "string" ||
    !/^[A-Za-z0-9_-]{6,64}$/.test(orderId) ||
    !Number.isInteger(amount) ||
    (amount as number) <= 0
  ) {
    return null;
  }

  return { paymentKey, orderId, amount: amount as number };
}

function isMatchingCompletedPayment(payment: TossPayment, input: ConfirmRequest) {
  return (
    payment.status === "DONE" &&
    payment.paymentKey === input.paymentKey &&
    payment.orderId === input.orderId &&
    payment.totalAmount === input.amount
  );
}

function isActiveEntitlement(entitlement: EntitlementRow | null) {
  if (!entitlement || entitlement.status !== "active") return false;
  return entitlement.expires_at === null || new Date(entitlement.expires_at) > new Date();
}

function resolveConfirmationFailure(code: string) {
  if (code === "REJECT_CARD_PAYMENT") {
    return "카드 결제가 승인되지 않았습니다. 다른 카드나 결제수단을 이용해 주세요.";
  }
  if (code === "NOT_FOUND_PAYMENT_SESSION") {
    return "결제 인증 시간이 만료되었습니다. 주문 페이지에서 다시 결제해 주세요.";
  }
  if (code === "FORBIDDEN_REQUEST") {
    return "결제 요청 정보를 확인하지 못했습니다. 다시 결제해 주세요.";
  }
  return "결제 승인을 완료하지 못했습니다. 주문 페이지에서 다시 시도해 주세요.";
}

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
