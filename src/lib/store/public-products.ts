import "server-only";

import { cache } from "react";
import { canUseLocalCatalogFallback } from "@/lib/runtime/catalog-fallback";
import { createPublicClient } from "@/lib/supabase/public";

export type PublicProduct = {
  id: string;
  slug: string;
  productType: "course" | "ebook";
  title: string;
  summary: string;
  priceKrw: number;
  accessPeriodDays: number | null;
  accessLabel: string;
  detailHref: string;
};

type ProductRow = {
  id: string;
  slug: string;
  product_type: PublicProduct["productType"];
  title: string;
  summary: string;
  price_krw: number;
  access_period_days: number | null;
  detail_path: string | null;
};

export const loadPublicProductBySlug = cache(async function loadPublicProductBySlug(
  slug: string
): Promise<PublicProduct | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_public_products", {
    target_slug: slug,
  });

  if (error) {
    console.error("Failed to load public product:", error.message);
    return null;
  }
  const row = Array.isArray(data) ? (data[0] as ProductRow | undefined) : undefined;
  if (!row) return canUseLocalCatalogFallback() ? buildTemporaryProduct(slug) : null;

  return {
    id: row.id,
    slug: row.slug,
    productType: row.product_type,
    title: row.title,
    summary: row.summary,
    priceKrw: row.price_krw,
    accessPeriodDays: row.access_period_days,
    accessLabel:
      row.access_period_days === null
        ? "기간 제한 없이 이용"
        : `${row.access_period_days}일 이용`,
    detailHref: resolveDetailHref(row),
  };
});

function buildTemporaryProduct(slug: string): PublicProduct | null {
  if (slug !== "small-account-ebook") return null;

  return {
    id: "catalog:small-account-ebook",
    slug,
    productType: "ebook",
    title: "작은 계정을 수익으로 연결하는 법",
    summary: "수익화 계정의 방향과 실행 순서를 한 권에 정리한 실전 워크북",
    priceKrw: 0,
    accessPeriodDays: null,
    accessLabel: "기간 제한 없이 이용",
    detailHref: "/",
  };
}

function resolveDetailHref(product: ProductRow) {
  if (product.product_type === "course") return `/courses/${product.slug}`;
  if (product.detail_path?.startsWith("/") && !product.detail_path.startsWith("/checkout")) {
    return product.detail_path;
  }
  return "/";
}
