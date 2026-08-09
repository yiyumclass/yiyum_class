import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** 뷰어가 그리는 한 장. 잠긴 장은 주소가 없다. */
export type ProductPage = {
  pageNumber: number;
  /** 볼 수 있는 장만 채워진다. 잠긴 장은 null이다. */
  imageUrl: string | null;
  width: number | null;
  height: number | null;
  unlocked: boolean;
};

export type ProductPageView = {
  pages: ProductPage[];
  totalCount: number;
  unlockedCount: number;
  lockedCount: number;
};

const FILE_BUCKET = "product-files";
/** 화면을 그리는 동안만 살아 있으면 된다. */
const SIGNED_URL_TTL_SECONDS = 600;

type PageRow = {
  page_number: number;
  image_path: string | null;
  width: number | null;
  height: number | null;
  unlocked: boolean;
};

/**
 * 자료 페이지 목록.
 *
 * 세션을 읽는 클라이언트를 쓴다. 이용권을 가진 회원에게는 전체가, 그렇지 않은
 * 사람에게는 미리보기 구간만 주소가 붙는다. 잠긴 장은 서버가 주소를 만들지
 * 않으므로 화면에서 가리개를 걷어내도 볼 것이 없다.
 */
export const loadProductPages = cache(async function loadProductPages(
  slug: string
): Promise<ProductPageView> {
  const empty: ProductPageView = {
    pages: [],
    totalCount: 0,
    unlockedCount: 0,
    lockedCount: 0,
  };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_product_pages", {
    target_slug: slug,
  });

  if (error) {
    // 뷰어가 없다고 판매를 막을 이유는 없다. 소개와 내려받기는 그대로 선다.
    console.error("Failed to load product pages:", error.message);
    return empty;
  }

  const rows = (Array.isArray(data) ? data : []) as PageRow[];
  if (rows.length === 0) return empty;

  const readablePaths = rows
    .map((row) => row.image_path)
    .filter((path): path is string => Boolean(path));

  const signedByPath = new Map<string, string>();
  if (readablePaths.length > 0) {
    const { data: signed, error: signError } = await supabase.storage
      .from(FILE_BUCKET)
      .createSignedUrls(readablePaths, SIGNED_URL_TTL_SECONDS);

    if (signError) {
      console.error("Failed to sign product pages:", signError.message);
    } else {
      for (const entry of signed ?? []) {
        if (entry.path && entry.signedUrl) {
          signedByPath.set(entry.path, entry.signedUrl);
        }
      }
    }
  }

  const pages = rows.map((row) => ({
    pageNumber: row.page_number,
    imageUrl: row.image_path ? (signedByPath.get(row.image_path) ?? null) : null,
    width: row.width,
    height: row.height,
    unlocked: row.unlocked,
  }));

  const unlockedCount = pages.filter((page) => page.imageUrl !== null).length;

  return {
    pages,
    totalCount: pages.length,
    unlockedCount,
    lockedCount: pages.length - unlockedCount,
  };
});
