import "server-only";

import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/public";
import { resolveSellingPrice } from "./free-enrollment";

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
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, slug, product_type, title, summary, price_krw, access_period_days, detail_path"
    )
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle<ProductRow>();

  if (error) {
    console.error("Failed to load public product:", error.message);
    return null;
  }
  if (!data) return buildTemporaryProduct(slug);

  return {
    id: data.id,
    slug: data.slug,
    productType: data.product_type,
    title: data.title,
    summary: data.summary,
    priceKrw: resolveSellingPrice(data.price_krw),
    accessPeriodDays: data.access_period_days,
    accessLabel:
      data.access_period_days === null
        ? "기간 제한 없이 이용"
        : `${data.access_period_days}일 이용`,
    detailHref: resolveDetailHref(data),
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
