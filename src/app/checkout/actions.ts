"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isTossPaymentConfigured } from "@/lib/store/free-enrollment";
import { REFUND_POLICY_VERSION } from "@/lib/payments/refund-policy";
import { getVerifiedIdentity } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export type FreeEnrollmentState = {
  status: "idle" | "error";
  message: string;
};

export type CreatePaymentOrderResult =
  | {
      ok: true;
      order: {
        orderId: string;
        amount: number;
        orderName: string;
        productSlug: string;
      };
    }
  | { ok: false; message: string };

type PaymentOrderRow = {
  order_uid: string;
  amount: number;
  order_name: string;
  product_slug: string;
};

export async function createPaymentOrderAction(
  productSlug: string,
  refundPolicyAccepted: boolean
): Promise<CreatePaymentOrderResult> {
  if (!isTossPaymentConfigured()) {
    return { ok: false, message: "현재 결제 기능을 사용할 수 없습니다." };
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(productSlug)) {
    return { ok: false, message: "결제할 상품을 다시 확인해 주세요." };
  }
  if (refundPolicyAccepted !== true) {
    return { ok: false, message: "환불 정책과 콘텐츠 제공 개시에 동의해 주세요." };
  }

  const supabase = await createClient();
  const identity = await getVerifiedIdentity(supabase);
  if (!identity) {
    return { ok: false, message: "로그인 후 다시 결제해 주세요." };
  }

  const { data, error } = await supabase.rpc("create_toss_payment_order", {
    target_product_slug: productSlug,
  });

  if (error) {
    const setupRequired =
      error.code === "42883" || error.code === "PGRST202" || error.code === "PGRST205";
    const alreadyEnrolled = error.code === "23505";
    if (!setupRequired && !alreadyEnrolled) {
      console.error("Failed to create Toss payment order:", error.code);
    }
    return {
      ok: false,
      message: setupRequired
        ? "결제 데이터베이스 설정이 아직 적용되지 않았습니다."
        : alreadyEnrolled
          ? "이미 이용 중인 상품입니다. 마이 클래스에서 확인해 주세요."
          : "결제 주문을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  const row = (Array.isArray(data) ? data[0] : null) as PaymentOrderRow | null;
  if (
    !row ||
    !row.order_uid ||
    !Number.isInteger(row.amount) ||
    row.amount <= 0 ||
    !row.order_name
  ) {
    console.error("Toss payment order returned an invalid response.");
    return { ok: false, message: "결제 주문 정보를 확인하지 못했습니다." };
  }

  const { data: consentRecorded, error: consentError } = await supabase.rpc(
    "record_toss_refund_policy_consent",
    {
      target_order_uid: row.order_uid,
      target_policy_version: REFUND_POLICY_VERSION,
    }
  );
  if (consentError || consentRecorded !== true) {
    console.error("Failed to record refund policy consent:", consentError?.code);
    await supabase.rpc("fail_toss_payment_order", { target_order_uid: row.order_uid });
    return {
      ok: false,
      message: "환불 정책 동의를 기록하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  return {
    ok: true,
    order: {
      orderId: row.order_uid,
      amount: row.amount,
      orderName: row.order_name,
      productSlug: row.product_slug,
    },
  };
}

export async function markPaymentOrderFailedAction(orderId: string) {
  if (!/^ORD-[A-Za-z0-9_-]{6,60}$/.test(orderId)) return;

  const supabase = await createClient();
  const identity = await getVerifiedIdentity(supabase);
  if (!identity) return;

  const { error } = await supabase.rpc("fail_toss_payment_order", {
    target_order_uid: orderId,
  });
  if (error && error.code !== "42883" && error.code !== "PGRST202") {
    console.error("Failed to mark Toss payment order as failed:", error.code);
  }
}

export async function claimFreeProductAction(
  productSlug: string,
  _previousState: FreeEnrollmentState,
  _formData: FormData
): Promise<FreeEnrollmentState> {
  void _previousState;
  void _formData;

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(productSlug)) {
    return { status: "error", message: "신청할 콘텐츠를 다시 확인해 주세요." };
  }

  const supabase = await createClient();
  const identity = await getVerifiedIdentity(supabase);

  if (!identity) {
    return { status: "error", message: "로그인 후 다시 신청해 주세요." };
  }

  const { error } = await supabase.rpc("claim_free_product", {
    target_product_slug: productSlug,
  });

  if (error) {
    const setupRequired =
      error.code === "42883" || error.code === "PGRST202" || error.code === "PGRST205";
    if (!setupRequired) {
      console.error("Failed to claim free product:", error.message);
    }
    return {
      status: "error",
      message: setupRequired
        ? "무료 신청 기능 설정이 아직 적용되지 않았습니다. 잠시 후 다시 시도해 주세요."
        : "무료 신청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  revalidatePath("/my");
  revalidatePath(`/learn/${productSlug}`);
  redirect(`/my?enrolled=${encodeURIComponent(productSlug)}`);
}
