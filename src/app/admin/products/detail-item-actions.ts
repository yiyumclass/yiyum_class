"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/safe-input";

export type ProductMutationResult = { ok: boolean; message: string };

const MAX_TITLE = 120;
const MAX_BODY = 500;

export async function createDetailItemAction(
  productId: string,
  values: { title: string; body: string }
): Promise<ProductMutationResult> {
  await requireAdmin();

  if (!isUuid(productId)) {
    return { ok: false, message: "상품 정보를 확인해 주세요." };
  }

  const invalid = validate(values);
  if (invalid) return { ok: false, message: invalid };

  const supabase = await createClient();
  // 새 항목은 항상 맨 아래에 붙는다. 순서는 그 뒤에 바꾼다.
  const { data: last } = await supabase
    .from("product_detail_items")
    .select("sort_order")
    .eq("product_id", productId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();

  const { error } = await supabase.from("product_detail_items").insert({
    product_id: productId,
    sort_order: (last?.sort_order ?? -1) + 1,
    title: values.title.trim(),
    body: values.body.trim(),
  });

  if (error) {
    console.error("Failed to create detail item:", error.message);
    return { ok: false, message: "항목을 추가하지 못했습니다. 다시 시도해 주세요." };
  }

  await revalidateFor(supabase, productId);
  return { ok: true, message: "항목을 추가했습니다." };
}

export async function updateDetailItemAction(
  itemId: string,
  values: { title: string; body: string }
): Promise<ProductMutationResult> {
  await requireAdmin();

  if (!isUuid(itemId)) {
    return { ok: false, message: "항목 정보를 확인해 주세요." };
  }

  const invalid = validate(values);
  if (invalid) return { ok: false, message: invalid };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_detail_items")
    .update({ title: values.title.trim(), body: values.body.trim() })
    .eq("id", itemId)
    .select("product_id")
    .maybeSingle<{ product_id: string }>();

  if (error || !data) {
    if (error) console.error("Failed to update detail item:", error.message);
    return { ok: false, message: "항목을 수정하지 못했습니다. 다시 시도해 주세요." };
  }

  await revalidateFor(supabase, data.product_id);
  return { ok: true, message: "항목을 수정했습니다." };
}

export async function deleteDetailItemAction(
  itemId: string
): Promise<ProductMutationResult> {
  await requireAdmin();

  if (!isUuid(itemId)) {
    return { ok: false, message: "항목 정보를 확인해 주세요." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_detail_items")
    .delete()
    .eq("id", itemId)
    .select("product_id")
    .maybeSingle<{ product_id: string }>();

  if (error || !data) {
    if (error) console.error("Failed to delete detail item:", error.message);
    return { ok: false, message: "항목을 삭제하지 못했습니다. 다시 시도해 주세요." };
  }

  await revalidateFor(supabase, data.product_id);
  return { ok: true, message: "항목을 삭제했습니다." };
}

/**
 * 두 항목의 순서를 맞바꾼다.
 *
 * 목록 전체를 다시 번호 매기지 않는 이유는, 화면이 보고 있던 순서와 저장된
 * 순서가 어긋난 사이에 다른 창에서 항목이 늘면 엉뚱한 줄이 밀리기 때문이다.
 * 맞바꾸기는 두 줄만 건드려서 그 사이에 무슨 일이 있었든 결과가 예측된다.
 */
export async function swapDetailItemOrderAction(
  itemId: string,
  direction: "up" | "down"
): Promise<ProductMutationResult> {
  await requireAdmin();

  if (!isUuid(itemId)) {
    return { ok: false, message: "항목 정보를 확인해 주세요." };
  }

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("product_detail_items")
    .select("id, product_id, sort_order")
    .eq("id", itemId)
    .maybeSingle<{ id: string; product_id: string; sort_order: number }>();

  if (!current) {
    return { ok: false, message: "항목을 찾지 못했습니다." };
  }

  const { data: neighbor } = await supabase
    .from("product_detail_items")
    .select("id, sort_order")
    .eq("product_id", current.product_id)
    .order("sort_order", { ascending: direction === "down" })
    [direction === "down" ? "gt" : "lt"]("sort_order", current.sort_order)
    .limit(1)
    .maybeSingle<{ id: string; sort_order: number }>();

  if (!neighbor) {
    return { ok: false, message: "더 옮길 수 없습니다." };
  }

  const [first, second] = await Promise.all([
    supabase
      .from("product_detail_items")
      .update({ sort_order: neighbor.sort_order })
      .eq("id", current.id),
    supabase
      .from("product_detail_items")
      .update({ sort_order: current.sort_order })
      .eq("id", neighbor.id),
  ]);

  if (first.error || second.error) {
    console.error(
      "Failed to swap detail item order:",
      first.error?.message ?? second.error?.message
    );
    return { ok: false, message: "순서를 바꾸지 못했습니다. 다시 시도해 주세요." };
  }

  await revalidateFor(supabase, current.product_id);
  return { ok: true, message: "순서를 바꿨습니다." };
}

function validate(values: { title: string; body: string }) {
  const title = values.title.trim();
  if (!title || title.length > MAX_TITLE) {
    return `항목 제목은 1자 이상 ${MAX_TITLE}자 이하로 입력해 주세요.`;
  }
  if (values.body.trim().length > MAX_BODY) {
    return `항목 설명은 ${MAX_BODY}자 이하로 입력해 주세요.`;
  }
  return null;
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

async function revalidateFor(supabase: ServerClient, productId: string) {
  const { data } = await supabase
    .from("products")
    .select("slug")
    .eq("id", productId)
    .maybeSingle<{ slug: string }>();

  revalidatePath("/admin/products");
  revalidatePath("/library");
  if (data?.slug) revalidatePath(`/library/${data.slug}`);
}
