import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type ProductEntitlement = {
  productSlug: string;
  productType: "course" | "ebook";
  expiresAt: string | null;
};

type EntitlementRow = {
  product_slug: string;
  product_type: ProductEntitlement["productType"];
  expires_at: string | null;
};

export async function loadMyActiveProductEntitlements(
  supabase: SupabaseClient
): Promise<ProductEntitlement[]> {
  const { data, error } = await supabase.rpc("get_my_active_product_entitlements");

  if (error) {
    const unavailable =
      error.code === "42883" || error.code === "PGRST202" || error.code === "PGRST205";
    if (!unavailable) {
      console.error("Failed to load product entitlements:", error.message);
    }
    return [];
  }

  return ((data ?? []) as unknown as EntitlementRow[]).map((row) => ({
    productSlug: row.product_slug,
    productType: row.product_type,
    expiresAt: row.expires_at,
  }));
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
