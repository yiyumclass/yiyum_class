"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getVerifiedIdentity } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export type FreeEnrollmentState = {
  status: "idle" | "error";
  message: string;
};

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
