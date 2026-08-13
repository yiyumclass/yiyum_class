"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import type { AdminProductStatus } from "@/lib/admin/products";
import { createClient } from "@/lib/supabase/server";
import { isSafeLocalPath, isUuid } from "@/lib/validation/safe-input";
import type { ProductType } from "@/lib/store/product-type";

export type CreateProductState = {
  status: "idle" | "error" | "success";
  message: string;
  fieldErrors: Partial<
    Record<
      | "title"
      | "slug"
      | "priceKrw"
      | "listPriceKrw"
      | "accessPeriodDays"
      | "summary"
      | "detailBody"
      | "thumbnailPath"
      | "detailPath"
      | "courseSetupMode"
      | "courseId"
      | "courseAccessMode"
      | "courseSectionIds",
      string
    >
  >;
};

export type ProductMutationResult = {
  ok: boolean;
  message: string;
};

const productTypes: ProductType[] = ["course", "ebook", "consulting"];

const productStatuses: AdminProductStatus[] = [
  "draft",
  "active",
  "sold_out",
  "paused",
  "archived",
];

export async function createProductAction(
  _previousState: CreateProductState,
  formData: FormData
): Promise<CreateProductState> {
  const admin = await requireAdmin();
  const values = readProductForm(formData);
  const fieldErrors = validateProductForm(values);
  const courseSetupMode = readString(formData, "courseSetupMode");
  const courseId = readString(formData, "courseId");
  const courseSectionIds = formData
    .getAll("courseSectionIds")
    .filter((value): value is string => typeof value === "string");

  if (values.productType === "course") {
    if (!["new", "existing_selected"].includes(courseSetupMode)) {
      fieldErrors.courseSetupMode = "판매할 강의 구성을 선택해 주세요.";
    }
    if (courseSetupMode !== "new" && !isUuid(courseId)) {
      fieldErrors.courseId = "연결할 원본 강의를 선택해 주세요.";
    }
    if (courseSetupMode === "existing_selected" && courseSectionIds.length === 0) {
      fieldErrors.courseSectionIds = "판매할 챕터를 한 개 이상 선택해 주세요.";
    }
    if (courseSectionIds.some((sectionId) => !isUuid(sectionId))) {
      fieldErrors.courseSectionIds = "판매할 챕터를 다시 선택해 주세요.";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "입력한 상품 정보를 다시 확인해 주세요.",
      fieldErrors,
    };
  }

  const supabase = await createClient();
  // 강의 상품은 콘텐츠 연결이 끝나기 전까지 외부에 노출되지 않도록 우선 draft로 만든다.
  const { data: createdProduct, error } = await supabase
    .from("products")
    .insert({
      slug: values.slug,
      product_type: values.productType,
      title: values.title,
      summary: values.summary,
      price_krw: values.priceKrw,
      list_price_krw: values.listPriceKrw,
      access_period_days:
        values.accessMode === "period" ? values.accessPeriodDays : null,
      status: values.productType === "course" ? "draft" : values.status,
      thumbnail_path: values.thumbnailPath || null,
      detail_path: values.detailPath || null,
      created_by: admin.userId,
      updated_by: admin.userId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !createdProduct) {
    console.error("Failed to create product:", error.message);

    if (error.code === "23505") {
      return {
        status: "error",
        message: "이미 사용 중인 상품 주소입니다.",
        fieldErrors: { slug: "다른 상품 주소를 입력해 주세요." },
      };
    }

    if (error.code === "42P01" || error.code === "PGRST205") {
      return {
        status: "error",
        message: "현재 상품 등록 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        fieldErrors: {},
      };
    }

    return {
      status: "error",
      message: "상품을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      fieldErrors: {},
    };
  }

  if (values.productType === "course") {
    const setupError = await configureCreatedCourseProduct({
      supabase,
      adminUserId: admin.userId,
      productId: createdProduct.id,
      values,
      courseSetupMode,
      courseId,
      courseSectionIds,
    });
    if (setupError) {
      return {
        status: "error",
        message: `상품은 작성 중으로 저장했지만 강의 연결을 완료하지 못했습니다. ${setupError}`,
        fieldErrors: {},
      };
    }

    if (values.status === "active") {
      const { error: activationError } = await supabase
        .from("products")
        .update({ status: "active" })
        .eq("id", createdProduct.id);
      if (activationError) {
        return {
          status: "error",
          message: "상품과 강의는 저장했지만 판매를 시작하지 못했습니다. 작성 중 상품에서 다시 시도해 주세요.",
          fieldErrors: {},
        };
      }
    }
  }

  revalidatePath("/admin");
  revalidatePath("/admin/products");
  revalidatePath("/admin/courses");
  revalidatePublicCatalog(values.slug);

  return {
    status: "success",
    message:
      values.productType === "course"
        ? `새 강의 상품과 판매 범위를 ${formatStatus(values.status)} 상태로 등록했습니다.`
        : `새 상품을 ${formatStatus(values.status)} 상태로 등록했습니다.`,
    fieldErrors: {},
  };
}

async function configureCreatedCourseProduct({
  supabase,
  adminUserId,
  productId,
  values,
  courseSetupMode,
  courseId,
  courseSectionIds,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  adminUserId: string;
  productId: string;
  values: ProductFormValues;
  courseSetupMode: string;
  courseId: string;
  courseSectionIds: string[];
}) {
  if (courseSetupMode === "new") {
    const { error } = await supabase.from("courses").insert({
      product_id: productId,
      slug: values.slug,
      title: values.title,
      short_title: values.title.slice(0, 80),
      description: values.summary,
      instructor: "",
      poster_path: values.thumbnailPath || null,
      status: "draft",
      created_by: adminUserId,
      updated_by: adminUserId,
    });
    if (error) {
      console.error("Failed to create course with product:", error.message);
      return "강의 관리에서 해당 상품의 연결을 다시 설정해 주세요.";
    }
    return null;
  }

  const { error } = await supabase.rpc("admin_set_product_course_scope", {
    target_product_id: productId,
    target_course_id: courseId,
    target_access_mode: "selected",
    target_section_ids: courseSectionIds,
  });
  if (error) {
    console.error("Failed to connect course product:", error.message);
    return "원본 강의와 판매 챕터를 확인한 뒤 상품 수정에서 다시 연결해 주세요.";
  }
  return null;
}

export async function updateProductStatusAction(
  productId: string,
  nextStatus: AdminProductStatus
): Promise<ProductMutationResult> {
  await requireAdmin();

  if (!isUuid(productId) || !productStatuses.includes(nextStatus)) {
    return { ok: false, message: "변경할 상품 상태를 확인해 주세요." };
  }

  const supabase = await createClient();
  if (nextStatus === "active") {
    const { data: targetProduct } = await supabase
      .from("products")
      .select("product_type")
      .eq("id", productId)
      .maybeSingle<{ product_type: ProductType }>();
    if (targetProduct?.product_type === "course") {
      const { data: scope } = await supabase
        .from("product_course_scopes")
        .select("product_id")
        .eq("product_id", productId)
        .maybeSingle<{ product_id: string }>();
      if (!scope) {
        return {
          ok: false,
          message: "원본 강의와 판매 범위를 먼저 연결한 뒤 판매를 시작해 주세요.",
        };
      }
    }
  }
  const { data, error } = await supabase
    .from("products")
    .update({ status: nextStatus })
    .eq("id", productId)
    .select("id, slug")
    .maybeSingle<{ id: string; slug: string }>();

  if (error || !data) {
    if (error) {
      console.error("Failed to update product status:", error.message);
    }

    return {
      ok: false,
      message: "상품 상태를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/products");
  revalidatePath("/admin/courses");
  revalidatePublicCatalog(data.slug);

  return { ok: true, message: `${formatStatus(nextStatus)} 상태로 변경했습니다.` };
}

export async function updateProductAction(
  productId: string,
  _previousState: CreateProductState,
  formData: FormData
): Promise<CreateProductState> {
  await requireAdmin();

  if (!isUuid(productId)) {
    return {
      status: "error",
      message: "수정할 상품 정보를 확인해 주세요.",
      fieldErrors: {},
    };
  }

  const values = readEditableProductForm(formData);
  const fieldErrors = validateEditableProductForm(values);
  const courseScopeEnabled = readString(formData, "courseScopeEnabled") === "true";
  const courseId = readString(formData, "courseId");
  const courseAccessMode = readString(formData, "courseAccessMode");
  const courseSectionIds = formData
    .getAll("courseSectionIds")
    .filter((value): value is string => typeof value === "string");

  if (courseScopeEnabled) {
    if (!isUuid(courseId)) fieldErrors.courseId = "연결할 원본 강의를 선택해 주세요.";
    if (courseAccessMode !== "full" && courseAccessMode !== "selected") {
      fieldErrors.courseAccessMode = "전체 강의 또는 선택 챕터를 선택해 주세요.";
    }
    if (courseAccessMode === "selected" && courseSectionIds.length === 0) {
      fieldErrors.courseSectionIds = "판매할 챕터를 한 개 이상 선택해 주세요.";
    }
    if (courseSectionIds.some((sectionId) => !isUuid(sectionId))) {
      fieldErrors.courseSectionIds = "판매할 챕터를 다시 선택해 주세요.";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "입력한 상품 정보를 다시 확인해 주세요.",
      fieldErrors,
    };
  }

  const supabase = await createClient();
  // 판매 범위를 먼저 확정해야 같은 요청에서 판매 중으로 바뀌어도 빈 권한이 노출되지 않는다.
  if (courseScopeEnabled) {
    const { error: scopeError } = await supabase.rpc(
      "admin_set_product_course_scope",
      {
        target_product_id: productId,
        target_course_id: courseId,
        target_access_mode: courseAccessMode,
        target_section_ids: courseAccessMode === "selected" ? courseSectionIds : [],
      }
    );
    if (scopeError) {
      console.error("Failed to update course sale scope:", scopeError.message);
      return {
        status: "error",
        message: "판매 범위를 반영하지 못했습니다. 원본 강의와 챕터를 확인해 주세요.",
        fieldErrors: {},
      };
    }
  } else if (values.status === "active") {
    const { data: targetProduct } = await supabase
      .from("products")
      .select("product_type")
      .eq("id", productId)
      .maybeSingle<{ product_type: ProductType }>();
    if (targetProduct?.product_type === "course") {
      const { data: scope } = await supabase
        .from("product_course_scopes")
        .select("product_id")
        .eq("product_id", productId)
        .maybeSingle<{ product_id: string }>();
      if (!scope) {
        return {
          status: "error",
          message: "원본 강의와 판매 범위를 먼저 연결한 뒤 판매를 시작해 주세요.",
          fieldErrors: {},
        };
      }
    }
  }

  // slug는 수정 대상에서 제외한다: lesson_progress가 상품 slug를 텍스트 키로 참조하므로
  // 생성 후 불변 계약이다. slug 변경 필드를 이 수정 경로에 추가하지 말 것.
  const { data, error } = await supabase
    .from("products")
    .update({
      title: values.title,
      summary: values.summary,
      detail_body: values.detailBody || null,
      price_krw: values.priceKrw,
      list_price_krw: values.listPriceKrw,
      access_period_days:
        values.accessMode === "period" ? values.accessPeriodDays : null,
      status: values.status,
      thumbnail_path: values.thumbnailPath || null,
      detail_path: values.detailPath || null,
    })
    .eq("id", productId)
    .select("id, slug")
    .maybeSingle<{ id: string; slug: string }>();

  if (error || !data) {
    if (error) {
      console.error("Failed to update product:", error.message);
    }

    const databaseMissing =
      error?.code === "42P01" || error?.code === "PGRST205";

    return {
      status: "error",
      message: databaseMissing
        ? "현재 상품 수정 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."
        : "상품을 수정하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      fieldErrors: {},
    };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/products");
  revalidatePath("/admin/courses");
  revalidatePublicCatalog(data.slug);

  return {
    status: "success",
    message: "상품 정보를 수정했습니다.",
    fieldErrors: {},
  };
}

type ProductFormValues = {
  productType: ProductType;
  title: string;
  slug: string;
  summary: string;
  priceKrw: number;
  /** 할인 전 정가. 비워두면 null이고 세일 표시가 붙지 않는다. */
  listPriceKrw: number | null;
  accessMode: "period" | "lifetime";
  accessPeriodDays: number;
  status: "draft" | "active";
  thumbnailPath: string;
  detailPath: string;
};

type EditableProductFormValues = Omit<
  ProductFormValues,
  "productType" | "slug" | "status"
> & {
  status: AdminProductStatus;
  detailBody: string;
};

function readProductForm(formData: FormData): ProductFormValues {
  const productType = readString(formData, "productType");
  const accessMode = readString(formData, "accessMode");
  const status = readString(formData, "status");

  return {
    productType: productTypes.includes(productType as ProductType)
      ? (productType as ProductType)
      : "course",
    title: readString(formData, "title"),
    slug: readString(formData, "slug").toLowerCase(),
    summary: readString(formData, "summary"),
    priceKrw: readNumber(formData, "priceKrw"),
    listPriceKrw: readOptionalNumber(formData, "listPriceKrw"),
    accessMode: accessMode === "lifetime" ? "lifetime" : "period",
    accessPeriodDays: readNumber(formData, "accessPeriodDays"),
    status: status === "active" ? "active" : "draft",
    thumbnailPath: readString(formData, "thumbnailPath"),
    detailPath: readString(formData, "detailPath"),
  };
}

function readEditableProductForm(formData: FormData): EditableProductFormValues {
  const accessMode = readString(formData, "accessMode");
  const rawStatus = readString(formData, "status") as AdminProductStatus;

  return {
    title: readString(formData, "title"),
    summary: readString(formData, "summary"),
    detailBody: readString(formData, "detailBody"),
    priceKrw: readNumber(formData, "priceKrw"),
    listPriceKrw: readOptionalNumber(formData, "listPriceKrw"),
    accessMode: accessMode === "lifetime" ? "lifetime" : "period",
    accessPeriodDays: readNumber(formData, "accessPeriodDays"),
    status: productStatuses.includes(rawStatus) ? rawStatus : "draft",
    thumbnailPath: readString(formData, "thumbnailPath"),
    detailPath: readString(formData, "detailPath"),
  };
}

function validateProductForm(values: ProductFormValues) {
  const errors: CreateProductState["fieldErrors"] = {};

  if (!values.title || values.title.length > 120) {
    errors.title = "상품명은 1자 이상 120자 이하로 입력해 주세요.";
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.slug)) {
    errors.slug = "영문 소문자, 숫자와 하이픈만 사용할 수 있습니다.";
  }

  if (!Number.isInteger(values.priceKrw) || values.priceKrw < 0) {
    errors.priceKrw = "판매가는 0원 이상의 숫자로 입력해 주세요.";
  }

  const listPriceError = validateListPrice(values);
  if (listPriceError) {
    errors.listPriceKrw = listPriceError;
  }

  if (
    values.accessMode === "period" &&
    (!Number.isInteger(values.accessPeriodDays) || values.accessPeriodDays < 1)
  ) {
    errors.accessPeriodDays = "이용 기간을 1일 이상으로 입력해 주세요.";
  }

  if (values.summary.length > 500) {
    errors.summary = "상품 설명은 500자 이하로 입력해 주세요.";
  }

  if (values.thumbnailPath && !isSafeLocalPath(values.thumbnailPath)) {
    errors.thumbnailPath = "사이트 내부 경로를 /로 시작해 입력해 주세요.";
  }

  if (values.detailPath && !isSafeLocalPath(values.detailPath)) {
    errors.detailPath = "사이트 내부 경로를 /로 시작해 입력해 주세요.";
  }

  return errors;
}

function validateEditableProductForm(values: EditableProductFormValues) {
  const errors: CreateProductState["fieldErrors"] = {};

  if (values.detailBody.length > 4000) {
    errors.detailBody = "자료 소개는 4,000자 이하로 입력해 주세요.";
  }

  if (!values.title || values.title.length > 120) {
    errors.title = "상품명은 1자 이상 120자 이하로 입력해 주세요.";
  }

  if (!Number.isInteger(values.priceKrw) || values.priceKrw < 0) {
    errors.priceKrw = "판매가는 0원 이상의 숫자로 입력해 주세요.";
  }

  const listPriceError = validateListPrice(values);
  if (listPriceError) {
    errors.listPriceKrw = listPriceError;
  }

  if (
    values.accessMode === "period" &&
    (!Number.isInteger(values.accessPeriodDays) || values.accessPeriodDays < 1)
  ) {
    errors.accessPeriodDays = "이용 기간을 1일 이상으로 입력해 주세요.";
  }

  if (values.summary.length > 500) {
    errors.summary = "상품 설명은 500자 이하로 입력해 주세요.";
  }

  if (values.thumbnailPath && !isSafeLocalPath(values.thumbnailPath)) {
    errors.thumbnailPath = "사이트 내부 경로를 /로 시작해 입력해 주세요.";
  }

  if (values.detailPath && !isSafeLocalPath(values.detailPath)) {
    errors.detailPath = "사이트 내부 경로를 /로 시작해 입력해 주세요.";
  }

  return errors;
}

/** 정가는 비워도 되지만, 넣었다면 판매가보다 낮을 수 없다. 낮으면 취소선이 뒤집힌다. */
function validateListPrice(values: {
  priceKrw: number;
  listPriceKrw: number | null;
}) {
  if (values.listPriceKrw === null) return null;

  if (!Number.isInteger(values.listPriceKrw) || values.listPriceKrw < 0) {
    return "정가는 0원 이상의 숫자로 입력하거나 비워 주세요.";
  }

  if (Number.isInteger(values.priceKrw) && values.listPriceKrw < values.priceKrw) {
    return "정가는 판매가보다 낮을 수 없습니다. 할인 전 가격을 입력해 주세요.";
  }

  return null;
}

function revalidatePublicCatalog(slug: string) {
  revalidatePath("/");
  revalidatePath("/courses");
  revalidatePath(`/courses/${slug}`);
  revalidatePath("/checkout");
  revalidatePath("/learn", "layout");
  revalidatePath("/my");
}

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(formData: FormData, key: string) {
  const raw = readString(formData, key).replaceAll(",", "");
  return raw ? Number(raw) : Number.NaN;
}

/** 빈 값과 0을 구분한다. 비우면 세일 아님, 0은 잘못 입력한 값이라 검증에서 걸러진다. */
function readOptionalNumber(formData: FormData, key: string) {
  const raw = readString(formData, key).replaceAll(",", "");
  if (!raw) return null;
  return Number(raw);
}

function formatStatus(status: AdminProductStatus) {
  const labels: Record<AdminProductStatus, string> = {
    draft: "작성 중",
    active: "판매 중",
    sold_out: "품절",
    paused: "판매 중지",
    archived: "보관",
  };
  return labels[status];
}
