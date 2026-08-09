import "server-only";

import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/public";

/** 상세에 반복해 나오는 줄. 자료 구성 안내에 쓴다. */
export type PublicDetailItem = {
  id: string;
  title: string;
  body: string;
};

type DetailItemRow = {
  product_slug: string;
  item_id: string;
  sort_order: number;
  title: string;
  body: string;
};

export const loadPublicDetailItems = cache(async function loadPublicDetailItems(
  slug: string
): Promise<PublicDetailItem[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_public_product_detail_items", {
    target_slug: slug,
  });

  if (error) {
    // 상세 항목이 없다고 판매를 막을 이유는 없다. 소개문만으로도 화면은 선다.
    console.error("Failed to load product detail items:", error.message);
    return [];
  }

  const rows = (Array.isArray(data) ? data : []) as DetailItemRow[];
  return rows.map((row) => ({
    id: row.item_id,
    title: row.title,
    body: row.body,
  }));
});
