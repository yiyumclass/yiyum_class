"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/safe-input";

export type ProductMutationResult = { ok: boolean; message: string };

const FILE_BUCKET = "product-files";

/**
 * 업로드는 브라우저가 버킷에 직접 한다. 서버 액션 본문으로 파일을 실어 나르면
 * 큰 자료에서 요청 한도에 걸린다. 여기서는 올라간 객체의 위치만 받아 적는다.
 */
export async function saveProductFileAction(
  productId: string,
  file: { path: string; name: string; contentType: string; sizeBytes: number }
): Promise<ProductMutationResult> {
  await requireAdmin();

  if (!isUuid(productId)) {
    return { ok: false, message: "상품 정보를 확인해 주세요." };
  }
  if (!file.path || file.path.includes("..") || file.path.startsWith("/")) {
    return { ok: false, message: "자료 파일 경로를 확인해 주세요." };
  }

  const supabase = await createClient();
  const current = await readCurrentFile(supabase, productId);

  const { error } = await supabase
    .from("products")
    .update({
      file_path: file.path,
      file_name: file.name.slice(0, 200),
      file_content_type: file.contentType || null,
      file_size_bytes: Number.isFinite(file.sizeBytes) ? file.sizeBytes : null,
      file_uploaded_at: new Date().toISOString(),
    })
    .eq("id", productId);

  if (error) {
    console.error("Failed to save product file:", error.message);
    // 연결에 실패했으면 방금 올린 객체는 아무도 못 쓰는 쓰레기가 된다.
    await removeStoredObject(supabase, file.path);
    return { ok: false, message: "자료를 연결하지 못했습니다. 다시 시도해 주세요." };
  }

  // 교체한 경우에만 이전 객체를 지운다. 실패해도 연결은 이미 끝났으므로 되돌리지 않는다.
  if (current?.path && current.path !== file.path) {
    await removeStoredObject(supabase, current.path);
  }

  revalidateProduct(current?.slug ?? null);
  return { ok: true, message: "자료 파일을 연결했습니다." };
}

export async function removeProductFileAction(
  productId: string
): Promise<ProductMutationResult> {
  await requireAdmin();

  if (!isUuid(productId)) {
    return { ok: false, message: "상품 정보를 확인해 주세요." };
  }

  const supabase = await createClient();
  const current = await readCurrentFile(supabase, productId);

  const { error } = await supabase
    .from("products")
    .update({
      file_path: null,
      file_name: null,
      file_content_type: null,
      file_size_bytes: null,
      file_uploaded_at: null,
    })
    .eq("id", productId);

  if (error) {
    console.error("Failed to remove product file:", error.message);
    return { ok: false, message: "자료를 삭제하지 못했습니다. 다시 시도해 주세요." };
  }

  if (current?.path) await removeStoredObject(supabase, current.path);

  revalidateProduct(current?.slug ?? null);
  return { ok: true, message: "자료 파일을 삭제했습니다." };
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

async function readCurrentFile(supabase: ServerClient, productId: string) {
  const { data } = await supabase
    .from("products")
    .select("slug, file_path")
    .eq("id", productId)
    .maybeSingle<{ slug: string; file_path: string | null }>();
  return data ? { slug: data.slug, path: data.file_path } : null;
}

async function removeStoredObject(supabase: ServerClient, path: string) {
  const { error } = await supabase.storage.from(FILE_BUCKET).remove([path]);
  if (error) {
    // 보관 비용만 남을 뿐 화면은 정상이라 실패해도 흐름을 막지 않는다.
    console.error("Failed to remove product file object:", error.message);
  }
}

function revalidateProduct(slug: string | null) {
  revalidatePath("/admin/products");
  revalidatePath("/library");
  if (slug) revalidatePath(`/library/${slug}`);
}
