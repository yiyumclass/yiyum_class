import "server-only";

import { cache } from "react";
import { canUseLocalCatalogFallback } from "@/lib/runtime/catalog-fallback";
import { createPublicClient } from "@/lib/supabase/public";
import type { ProductType } from "@/lib/store/product-type";

export type PublicProduct = {
  id: string;
  slug: string;
  productType: ProductType;
  title: string;
  summary: string;
  /** 상세 소개 문단. 빈 줄로 문단을 나눈다. */
  detailBody: string | null;
  priceKrw: number;
  /** 할인 전 정가. null이면 세일이 아니다. */
  listPriceKrw: number | null;
  /** 품절이면 목록에는 남지만 결제는 막힌다. */
  soldOut: boolean;
  /** 내려받을 자료가 붙어 있는지. 경로 자체는 공개하지 않는다. */
  hasFile: boolean;
  accessPeriodDays: number | null;
  accessLabel: string;
  thumbnailSrc: string | null;
  detailHref: string;
};

type ProductRow = {
  id: string;
  slug: string;
  product_type: PublicProduct["productType"];
  title: string;
  summary: string;
  detail_body: string | null;
  price_krw: number;
  list_price_krw: number | null;
  status: "active" | "sold_out";
  access_period_days: number | null;
  thumbnail_path: string | null;
  detail_path: string | null;
  has_file: boolean;
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

  return mapProductRow(row);
});

/** 강의가 아닌 상품을 판매 목록에 함께 실을 때 쓴다. 강의는 커리큘럼이 필요해 별도 로더가 있다. */
export const loadPublicProductsByType = cache(async function loadPublicProductsByType(
  productType: ProductType
): Promise<PublicProduct[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_public_products", {
    target_slug: null,
  });

  if (error) {
    console.error("Failed to load public products:", error.message);
    return [];
  }

  const rows = (Array.isArray(data) ? data : []) as ProductRow[];
  return rows
    .filter((row) => row.product_type === productType)
    .map(mapProductRow);
});

function mapProductRow(row: ProductRow): PublicProduct {
  return {
    id: row.id,
    slug: row.slug,
    productType: row.product_type,
    title: row.title,
    summary: row.summary,
    detailBody: row.detail_body,
    priceKrw: row.price_krw,
    listPriceKrw: row.list_price_krw,
    soldOut: row.status === "sold_out",
    hasFile: Boolean(row.has_file),
    accessPeriodDays: row.access_period_days,
    accessLabel:
      row.access_period_days === null
        ? "기간 제한 없이 이용"
        : `${row.access_period_days}일 이용`,
    thumbnailSrc: row.thumbnail_path?.startsWith("/") ? row.thumbnail_path : null,
    detailHref: resolveDetailHref(row),
  };
}

function buildTemporaryProduct(slug: string): PublicProduct | null {
  if (slug !== "small-account-ebook") return null;

  return {
    id: "catalog:small-account-ebook",
    slug,
    productType: "ebook",
    title: "작은 계정을 수익으로 연결하는 법",
    summary: "수익화 계정의 방향과 실행 순서를 한 권에 정리한 실전 워크북",
    detailBody: null,
    priceKrw: 0,
    listPriceKrw: null,
    soldOut: false,
    hasFile: false,
    accessPeriodDays: null,
    accessLabel: "기간 제한 없이 이용",
    thumbnailSrc: null,
    detailHref: "/",
  };
}

function resolveDetailHref(product: ProductRow) {
  if (product.product_type === "course" || product.product_type === "consulting") {
    return `/courses/${product.slug}`;
  }
  // 자료는 상세와 내려받기가 붙은 전용 화면이 있다. 직접 경로를 지정한
  // 예전 상품만 그 경로를 그대로 쓴다.
  if (product.detail_path?.startsWith("/") && !product.detail_path.startsWith("/checkout")) {
    return product.detail_path;
  }
  return `/library/${product.slug}`;
}
