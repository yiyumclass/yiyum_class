import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type ProductEntitlement = {
  productSlug: string;
  productType: "course" | "ebook";
  expiresAt: string | null;
};

export type ProductEntitlementLoadResult =
  | { available: true; entitlements: ProductEntitlement[] }
  | { available: false; errorMessage: string };

type EntitlementRow = {
  product_slug: string;
  product_type: ProductEntitlement["productType"];
  expires_at: string | null;
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
