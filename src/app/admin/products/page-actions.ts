"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/safe-input";

export type ProductMutationResult = { ok: boolean; message: string };

const FILE_BUCKET = "product-files";

export type UploadedPage = {
  pageNumber: number;
  imagePath: string;
  width: number;
  height: number;
};

/**
 * 변환한 페이지 이미지를 상품에 연결한다.
 *
 * 브라우저가 이미 버킷에 올린 뒤라 여기서는 위치만 받아 적는다. 이전 페이지는
 * 통째로 걷어낸다. 장수가 다른 두 벌이 섞이면 중간부터 다른 자료가 된다.
 */
export async function saveProductPagesAction(
  productId: string,
  pages: UploadedPage[],
  previewPageCount: number
): Promise<ProductMutationResult> {
  await requireAdmin();

  if (!isUuid(productId)) {
    return { ok: false, message: "상품 정보를 확인해 주세요." };
  }
  if (pages.length === 0) {
    return { ok: false, message: "변환된 페이지가 없습니다." };
  }
  if (pages.some((page) => !isSafeObjectPath(page.imagePath))) {
    return { ok: false, message: "페이지 이미지 경로를 확인해 주세요." };
  }

  const supabase = await createClient();
  const previous = await readPagePaths(supabase, productId);

  const { error: clearError } = await supabase
    .from("product_pages")
    .delete()
    .eq("product_id", productId);

  if (clearError) {
    console.error("Failed to clear product pages:", clearError.message);
    return { ok: false, message: "이전 페이지를 정리하지 못했습니다." };
  }

  const { error } = await supabase.from("product_pages").insert(
    pages.map((page) => ({
      product_id: productId,
      page_number: page.pageNumber,
      image_path: page.imagePath,
      width: page.width,
      height: page.height,
    }))
  );

  if (error) {
    console.error("Failed to save product pages:", error.message);
    await removeObjects(supabase, pages.map((page) => page.imagePath));
    return { ok: false, message: "페이지를 저장하지 못했습니다. 다시 시도해 주세요." };
  }

  const bounded = Math.max(0, Math.min(previewPageCount, pages.length));
  const { error: previewError } = await supabase
    .from("products")
    .update({ preview_page_count: bounded })
    .eq("id", productId);

  if (previewError) {
    console.error("Failed to save preview page count:", previewError.message);
  }

  const newPaths = new Set(pages.map((page) => page.imagePath));
  await removeObjects(
    supabase,
    previous.filter((path) => !newPaths.has(path))
  );

  await revalidateFor(supabase, productId);
  return {
    ok: true,
    message: `${pages.length}장을 등록했습니다. 앞 ${bounded}장을 미리보기로 엽니다.`,
  };
}

export async function updatePreviewPageCountAction(
  productId: string,
  previewPageCount: number
): Promise<ProductMutationResult> {
  await requireAdmin();

  if (!isUuid(productId)) {
    return { ok: false, message: "상품 정보를 확인해 주세요." };
  }

  const supabase = await createClient();
  const { count } = await supabase
    .from("product_pages")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);

  const bounded = Math.max(0, Math.min(previewPageCount, count ?? 0));
  const { error } = await supabase
    .from("products")
    .update({ preview_page_count: bounded })
    .eq("id", productId);

  if (error) {
    console.error("Failed to update preview page count:", error.message);
    return { ok: false, message: "미리보기 장수를 바꾸지 못했습니다." };
  }

  await revalidateFor(supabase, productId);
  return { ok: true, message: `앞 ${bounded}장을 미리보기로 엽니다.` };
}

export async function removeProductPagesAction(
  productId: string
): Promise<ProductMutationResult> {
  await requireAdmin();

  if (!isUuid(productId)) {
    return { ok: false, message: "상품 정보를 확인해 주세요." };
  }

  const supabase = await createClient();
  const previous = await readPagePaths(supabase, productId);

  const { error } = await supabase
    .from("product_pages")
    .delete()
    .eq("product_id", productId);

  if (error) {
    console.error("Failed to remove product pages:", error.message);
    return { ok: false, message: "페이지를 삭제하지 못했습니다." };
  }

  await supabase
    .from("products")
    .update({ preview_page_count: 0 })
    .eq("id", productId);
  await removeObjects(supabase, previous);

  await revalidateFor(supabase, productId);
  return { ok: true, message: "미리보기 페이지를 삭제했습니다." };
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

async function readPagePaths(supabase: ServerClient, productId: string) {
  const { data } = await supabase
    .from("product_pages")
    .select("image_path")
    .eq("product_id", productId)
    .returns<Array<{ image_path: string }>>();
  return (data ?? []).map((row) => row.image_path);
}

async function removeObjects(supabase: ServerClient, paths: string[]) {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(FILE_BUCKET).remove(paths);
  if (error) {
    // 보관 비용만 남을 뿐 화면은 정상이라 흐름을 막지 않는다.
    console.error("Failed to remove page objects:", error.message);
  }
}

function isSafeObjectPath(value: string) {
  return Boolean(value) && !value.includes("..") && !value.startsWith("/");
}

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
