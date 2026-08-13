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
  /** 상세 소개 문단. 빈 줄로 문단을 나눈다. */
  detailBody: string;
  priceKrw: number;
  /** 할인 전 정가. null이면 세일이 아니다. */
  listPriceKrw: number | null;
  accessPeriodDays: number | null;
  status: AdminProductStatus;
  thumbnailPath: string | null;
  detailPath: string | null;
  /** 내려받을 자료. 버킷 내부 경로만 담는다. */
  file: AdminProductFile | null;
  /** 변환해 둔 페이지 수 */
  pageCount: number;
  /** 로그인 없이 볼 수 있는 앞쪽 장수 */
  previewPageCount: number;
  updatedAt: string | null;
  source: "database" | "catalog";
  courseScope: AdminProductCourseScope | null;
};

export type AdminProductCourseScope = {
  courseId: string;
  accessMode: "full" | "selected";
  sectionIds: string[];
};

export type AdminCourseScopeOption = {
  id: string;
  slug: string;
  title: string;
  sections: Array<{ id: string; title: string; lessonCount: number }>;
};

export type AdminProductFile = {
  path: string;
  name: string;
  contentType: string | null;
  sizeBytes: number | null;
  uploadedAt: string | null;
};

export type AdminProductDetailItem = {
  id: string;
  sortOrder: number;
  title: string;
  body: string;
};

export type AdminProductsResult = {
  products: AdminProduct[];
  courseOptions: AdminCourseScopeOption[];
  courseScopesReady: boolean;
  databaseReady: boolean;
  message: string | null;
};

type ProductRow = {
  id: string;
  slug: string;
  product_type: AdminProductType;
  title: string;
  summary: string;
  detail_body: string | null;
  price_krw: number;
  list_price_krw: number | null;
  access_period_days: number | null;
  status: AdminProductStatus;
  thumbnail_path: string | null;
  detail_path: string | null;
  file_path: string | null;
  file_name: string | null;
  file_content_type: string | null;
  file_size_bytes: number | null;
  file_uploaded_at: string | null;
  preview_page_count: number | null;
  updated_at: string;
};

export async function loadAdminProducts(): Promise<AdminProductsResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, slug, product_type, title, summary, detail_body, price_krw, list_price_krw, access_period_days, status, thumbnail_path, detail_path, file_path, file_name, file_content_type, file_size_bytes, file_uploaded_at, preview_page_count, updated_at"
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
      courseOptions: [],
      courseScopesReady: false,
      databaseReady: false,
      message: tableMissing
        ? "현재 상품 관리 기능을 준비하고 있습니다. 잠시 후 다시 확인해 주세요."
        : "상품 정보를 불러오지 못했습니다. 잠시 후 페이지를 새로고침해 주세요.",
    };
  }

  const [pageCounts, courseScopeData] = await Promise.all([
    loadPageCounts(supabase),
    loadAdminCourseScopeData(supabase),
  ]);

  return {
    products: (data ?? []).map((row) => ({
      ...mapProductRow(row, pageCounts),
      courseScope: courseScopeData.scopeByProduct.get(row.id) ?? null,
    })),
    courseOptions: courseScopeData.courseOptions,
    courseScopesReady: courseScopeData.ready,
    databaseReady: true,
    message: null,
  };
}

function mapProductRow(
  row: ProductRow,
  pageCountByProduct: Map<string, number>
): AdminProduct {
  return {
    id: row.id,
    slug: row.slug,
    productType: row.product_type,
    title: row.title,
    summary: row.summary,
    detailBody: row.detail_body ?? "",
    priceKrw: row.price_krw,
    listPriceKrw: row.list_price_krw,
    accessPeriodDays: row.access_period_days,
    status: row.status,
    thumbnailPath: row.thumbnail_path,
    detailPath: row.detail_path,
    file: row.file_path
      ? {
          path: row.file_path,
          name: row.file_name ?? row.file_path.split("/").pop() ?? "자료 파일",
          contentType: row.file_content_type,
          sizeBytes: row.file_size_bytes,
          uploadedAt: row.file_uploaded_at,
        }
      : null,
    pageCount: pageCountByProduct.get(row.id) ?? 0,
    previewPageCount: row.preview_page_count ?? 0,
    updatedAt: row.updated_at,
    source: "database",
    courseScope: null,
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
      detailBody: "",
      priceKrw: product.price,
      listPriceKrw: null,
      accessPeriodDays: readAccessPeriod(product.accessLabel),
      status: "active",
      thumbnailPath: course?.posterSrc ?? null,
      detailPath: product.detailHref,
      file: null,
      pageCount: 0,
      previewPageCount: 0,
      updatedAt: null,
      source: "catalog",
      courseScope: null,
    };
  });
}

function readAccessPeriod(label: string) {
  const matchedDays = label.match(/(\d+)일/);
  return matchedDays ? Number(matchedDays[1]) : null;
}

async function loadAdminCourseScopeData(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{
  ready: boolean;
  courseOptions: AdminCourseScopeOption[];
  scopeByProduct: Map<string, AdminProductCourseScope>;
}> {
  const [courseResult, sectionResult, lessonResult, scopeResult, chosenResult] =
    await Promise.all([
      supabase
        .from("courses")
        .select("id, slug, title")
        .order("title")
        .returns<Array<{ id: string; slug: string; title: string }>>(),
      supabase
        .from("course_sections")
        .select("id, course_id, title, sort_order")
        .order("sort_order")
        .returns<Array<{ id: string; course_id: string; title: string; sort_order: number }>>(),
      supabase
        .from("lessons")
        .select("id, section_id, status")
        .returns<Array<{ id: string; section_id: string; status: string }>>(),
      supabase
        .from("product_course_scopes")
        .select("product_id, course_id, access_mode")
        .returns<Array<{
          product_id: string;
          course_id: string;
          access_mode: "full" | "selected";
        }>>(),
      supabase
        .from("product_course_scope_sections")
        .select("product_id, section_id")
        .returns<Array<{ product_id: string; section_id: string }>>(),
    ]);

  if (courseResult.error || sectionResult.error || lessonResult.error) {
    return { ready: false, courseOptions: [], scopeByProduct: new Map() };
  }
  if (scopeResult.error || chosenResult.error) {
    // 새 범위 마이그레이션 적용 전에도 기존 상품 편집은 계속 가능해야 한다.
    return { ready: false, courseOptions: [], scopeByProduct: new Map() };
  }

  const lessonCountBySection = new Map<string, number>();
  for (const lesson of lessonResult.data ?? []) {
    if (lesson.status !== "published") continue;
    lessonCountBySection.set(
      lesson.section_id,
      (lessonCountBySection.get(lesson.section_id) ?? 0) + 1
    );
  }
  const sectionsByCourse = new Map<
    string,
    AdminCourseScopeOption["sections"]
  >();
  for (const section of sectionResult.data ?? []) {
    const sections = sectionsByCourse.get(section.course_id) ?? [];
    sections.push({
      id: section.id,
      title: section.title,
      lessonCount: lessonCountBySection.get(section.id) ?? 0,
    });
    sectionsByCourse.set(section.course_id, sections);
  }

  const chosenByProduct = new Map<string, string[]>();
  for (const row of chosenResult.data ?? []) {
    const ids = chosenByProduct.get(row.product_id) ?? [];
    ids.push(row.section_id);
    chosenByProduct.set(row.product_id, ids);
  }
  const scopeByProduct = new Map<string, AdminProductCourseScope>();
  for (const row of scopeResult.data ?? []) {
    scopeByProduct.set(row.product_id, {
      courseId: row.course_id,
      accessMode: row.access_mode,
      sectionIds: chosenByProduct.get(row.product_id) ?? [],
    });
  }

  return {
    ready: true,
    courseOptions: (courseResult.data ?? []).map((course) => ({
      ...course,
      sections: sectionsByCourse.get(course.id) ?? [],
    })),
    scopeByProduct,
  };
}

/** 상품 상세에 붙는 반복 항목. 관리자 편집 화면이 쓴다. */
export async function loadAdminProductDetailItems(
  productId: string
): Promise<AdminProductDetailItem[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_detail_items")
    .select("id, sort_order, title, body")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .returns<
      Array<{ id: string; sort_order: number; title: string; body: string }>
    >();

  if (error) {
    console.error("Failed to load product detail items:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    sortOrder: row.sort_order,
    title: row.title,
    body: row.body,
  }));
}

/**
 * 상품별 상세 항목을 한 번에 읽는다.
 *
 * 편집 창을 열 때마다 따로 부르면 창이 뜨고 나서 목록이 늦게 채워져 깜빡인다.
 * 항목은 상품당 열 줄 안팎이라 목록과 함께 실어도 부담이 없다.
 */
export async function loadAdminDetailItemsByProduct(): Promise<
  Record<string, AdminProductDetailItem[]>
> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_detail_items")
    .select("id, product_id, sort_order, title, body")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .returns<
      Array<{
        id: string;
        product_id: string;
        sort_order: number;
        title: string;
        body: string;
      }>
    >();

  if (error) {
    // 항목이 없다고 상품 관리를 못 쓰게 만들 이유는 없다.
    console.error("Failed to load product detail items:", error.message);
    return {};
  }

  return (data ?? []).reduce<Record<string, AdminProductDetailItem[]>>(
    (grouped, row) => {
      const list = grouped[row.product_id] ?? [];
      list.push({
        id: row.id,
        sortOrder: row.sort_order,
        title: row.title,
        body: row.body,
      });
      grouped[row.product_id] = list;
      return grouped;
    },
    {}
  );
}

type AdminClient = Awaited<ReturnType<typeof createClient>>;

/** 상품별 변환된 페이지 수. 목록에서 미리보기 설정 상태를 바로 보여준다. */
async function loadPageCounts(supabase: AdminClient) {
  const { data, error } = await supabase
    .from("product_pages")
    .select("product_id")
    .returns<Array<{ product_id: string }>>();

  if (error) {
    console.error("Failed to load product page counts:", error.message);
    return new Map<string, number>();
  }

  return (data ?? []).reduce((counts, row) => {
    counts.set(row.product_id, (counts.get(row.product_id) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
}
