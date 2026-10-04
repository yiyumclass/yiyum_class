import "server-only";

import { getAdminAccess } from "@/lib/admin/auth";
import {
  isPaymentVerificationProduct,
  PAYMENT_VERIFICATION_AMOUNT,
} from "@/lib/payments/verification-product";
import { createClient } from "@/lib/supabase/server";
import { loadPublicProductBySlug, type PublicProduct } from "./public-products";

export async function loadCheckoutProduct(slug: string): Promise<PublicProduct | null> {
  if (!isPaymentVerificationProduct(slug)) return loadPublicProductBySlug(slug);

  const access = await getAdminAccess();
  if (access.status !== "granted" || access.admin.role !== "owner") return null;

  const supabase = await createClient();
  const { data, error } = await supabase.from("products")
    .select("id, slug, title, summary, price_krw, access_period_days")
    .eq("slug", slug)
    .eq("status", "draft")
    .eq("product_type", "course")
    .eq("price_krw", PAYMENT_VERIFICATION_AMOUNT)
    .maybeSingle();
  if (error || !data) return null;

  return {
    id: data.id,
    slug: data.slug,
    productType: "course",
    title: data.title,
    summary: data.summary,
    detailBody: null,
    priceKrw: data.price_krw,
    listPriceKrw: null,
    soldOut: false,
    hasFile: false,
    accessPeriodDays: data.access_period_days,
    accessLabel: "운영 결제 검증 전용",
    thumbnailSrc: null,
    detailHref: "/admin/orders",
  };
}
