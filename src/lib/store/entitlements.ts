import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type ProductEntitlement = {
  productSlug: string;
  productType: "course" | "ebook";
  expiresAt: string | null;
};

export type ProductLibraryEntitlement = ProductEntitlement & {
  title: string;
  summary: string;
  accessPeriodDays: number | null;
  detailHref: string;
};

export type ProductEntitlementLoadResult =
  | { available: true; entitlements: ProductEntitlement[] }
  | { available: false; errorMessage: string };

export type ProductLibraryLoadResult =
  | { available: true; entitlements: ProductLibraryEntitlement[] }
  | { available: false; errorMessage: string };

type EntitlementRow = {
  product_slug: string;
  product_type: ProductEntitlement["productType"];
  expires_at: string | null;
};

type ProductLibraryRow = EntitlementRow & {
  title: string;
  summary: string;
  access_period_days: number | null;
  detail_path: string | null;
};

export async function loadMyActiveProductEntitlements(
  supabase: SupabaseClient
): Promise<ProductEntitlementLoadResult> {
  const { data, error } = await supabase.rpc("get_my_active_product_entitlements");

  if (error) {
    const unavailable =
      error.code === "42883" || error.code === "PGRST202" || error.code === "PGRST205";
    if (!unavailable) {
      console.error("Failed to load product entitlements:", error.message);
    }
    return {
      available: false,
      errorMessage: unavailable
        ? "수강권 정보를 불러올 준비가 아직 완료되지 않았습니다."
        : "수강권 정보를 불러오지 못했습니다.",
    };
  }

  return {
    available: true,
    entitlements: ((data ?? []) as unknown as EntitlementRow[]).map((row) => ({
      productSlug: row.product_slug,
      productType: row.product_type,
      expiresAt: row.expires_at,
    })),
  };
}

export async function loadMyActiveProductLibrary(
  supabase: SupabaseClient
): Promise<ProductLibraryLoadResult> {
  const { data, error } = await supabase.rpc("get_my_active_product_library");

  if (error) {
    const unavailable =
      error.code === "42883" || error.code === "PGRST202" || error.code === "PGRST205";
    if (!unavailable) {
      console.error("Failed to load product library:", error.message);
    }

    const fallback = await loadMyActiveProductEntitlements(supabase);
    if (!fallback.available) return fallback;

    return {
      available: true,
      entitlements: fallback.entitlements.map((entitlement) => ({
        ...entitlement,
        title: formatFallbackProductTitle(entitlement.productSlug, entitlement.productType),
        summary:
          entitlement.productType === "ebook"
            ? "구매한 전자책 콘텐츠입니다."
            : "구매한 VOD 강의 콘텐츠입니다.",
        accessPeriodDays: null,
        detailHref:
          entitlement.productType === "course"
            ? `/courses/${entitlement.productSlug}`
            : "/my",
      })),
    };
  }

  return {
    available: true,
    entitlements: ((data ?? []) as unknown as ProductLibraryRow[]).map((row) => ({
      productSlug: row.product_slug,
      productType: row.product_type,
      expiresAt: row.expires_at,
      title: row.title,
      summary: row.summary,
      accessPeriodDays: row.access_period_days,
      detailHref: resolveDetailHref(row),
    })),
  };
}

export async function hasActiveProductEntitlement(
  supabase: SupabaseClient,
  productSlug: string
) {
  const { data, error } = await supabase.rpc("has_active_product_entitlement", {
    target_product_slug: productSlug,
  });

  if (error) {
    const unavailable =
      error.code === "42883" || error.code === "PGRST202" || error.code === "PGRST205";
    if (!unavailable) {
      console.error("Failed to verify product entitlement:", error.message);
    }
    return false;
  }

  return data === true;
}

function resolveDetailHref(product: ProductLibraryRow) {
  if (product.product_type === "course") return `/courses/${product.product_slug}`;
  if (product.detail_path?.startsWith("/") && !product.detail_path.startsWith("/checkout")) {
    return product.detail_path;
  }
  return "/my";
}

function formatFallbackProductTitle(
  slug: string,
  productType: ProductEntitlement["productType"]
) {
  const readableSlug = slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");

  return readableSlug || (productType === "course" ? "VOD 강의" : "전자책");
}
