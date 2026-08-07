import "server-only";

import { requireAdmin } from "@/lib/admin/auth";
import { courses } from "@/lib/learning/catalog";
import {
  canUseLocalCatalogFallback,
  logProductionCatalogFallbackBlocked,
} from "@/lib/runtime/catalog-fallback";
import { courseProducts } from "@/lib/store/course-products";
import { createClient } from "@/lib/supabase/server";
import type { ProductType } from "@/lib/store/product-type";

/** 어드민도 같은 유형 목록을 쓴다. 둘이 갈라지면 저장은 되는데 화면이 모르는 값이 생긴다. */
export type AdminProductType = ProductType;
export type AdminProductStatus =
  | "draft"
  | "active"
  | "sold_out"
  | "paused"
  | "archived";

export type AdminProduct = {
  id: string;
  slug: string;
  productType: AdminProductType;
  title: string;
  summary: string;
  priceKrw: number;
  /** 할인 전 정가. null이면 세일이 아니다. */
  listPriceKrw: number | null;
  accessPeriodDays: number | null;
  status: AdminProductStatus;
  thumbnailPath: string | null;
  detailPath: string | null;
  updatedAt: string | null;
  source: "database" | "catalog";
};

export type AdminProductsResult = {
  products: AdminProduct[];
  databaseReady: boolean;
  message: string | null;
};

type ProductRow = {
  id: string;
  slug: string;
  product_type: AdminProductType;
  title: string;
  summary: string;
  price_krw: number;
  list_price_krw: number | null;
  access_period_days: number | null;
  status: AdminProductStatus;
  thumbnail_path: string | null;
  detail_path: string | null;
  updated_at: string;
};

export async function loadAdminProducts(): Promise<AdminProductsResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, slug, product_type, title, summary, price_krw, list_price_krw, access_period_days, status, thumbnail_path, detail_path, updated_at"
    )
    .order("updated_at", { ascending: false })
    .returns<ProductRow[]>();

  if (error) {
    const tableMissing = error.code === "42P01" || error.code === "PGRST205";

    if (!tableMissing) {
      console.error("Failed to load admin products:", error.message);
    }

    const canUseFallback = canUseLocalCatalogFallback();
    const products = canUseFallback ? buildCatalogFallback() : [];

    if (!canUseFallback) {
      logProductionCatalogFallbackBlocked("Admin products");
    }

    return {
      products,
      databaseReady: false,
      message: tableMissing
        ? "현재 상품 관리 기능을 준비하고 있습니다. 잠시 후 다시 확인해 주세요."
        : "상품 정보를 불러오지 못했습니다. 잠시 후 페이지를 새로고침해 주세요.",
    };
  }

  return {
    products: (data ?? []).map(mapProductRow),
    databaseReady: true,
    message: null,
  };
}

function mapProductRow(row: ProductRow): AdminProduct {
  return {
    id: row.id,
    slug: row.slug,
    productType: row.product_type,
    title: row.title,
    summary: row.summary,
    priceKrw: row.price_krw,
    listPriceKrw: row.list_price_krw,
    accessPeriodDays: row.access_period_days,
    status: row.status,
    thumbnailPath: row.thumbnail_path,
    detailPath: row.detail_path,
    updatedAt: row.updated_at,
    source: "database",
  };
}

function buildCatalogFallback(): AdminProduct[] {
  return courseProducts.map((product) => {
    const course = courses.find((item) => item.slug === product.courseSlug);

    return {
      id: `catalog:${product.courseSlug}`,
      slug: product.courseSlug,
      productType: "course",
      title: course?.title ?? product.courseSlug,
      summary: course?.description ?? product.tagline,
      priceKrw: product.price,
      listPriceKrw: null,
      accessPeriodDays: readAccessPeriod(product.accessLabel),
      status: "active",
      thumbnailPath: course?.posterSrc ?? null,
      detailPath: product.detailHref,
      updatedAt: null,
      source: "catalog",
    };
  });
}

function readAccessPeriod(label: string) {
  const matchedDays = label.match(/(\d+)일/);
  return matchedDays ? Number(matchedDays[1]) : null;
}
