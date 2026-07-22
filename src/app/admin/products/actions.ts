"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import type { AdminProductStatus } from "@/lib/admin/products";
import { createClient } from "@/lib/supabase/server";

export type CreateProductState = {
  status: "idle" | "error" | "success";
  message: string;
  fieldErrors: Partial<
    Record<
      | "title"
      | "slug"
      | "priceKrw"
      | "accessPeriodDays"
      | "summary"
      | "thumbnailPath"
      | "detailPath",
      string
    >
  >;
};

export type ProductMutationResult = {
  ok: boolean;
  message: string;
};

const productStatuses: AdminProductStatus[] = [
  "draft",
  "active",
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

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "입력한 상품 정보를 다시 확인해 주세요.",
      fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("products").insert({
    slug: values.slug,
    product_type: values.productType,
    title: values.title,
    summary: values.summary,
    price_krw: values.priceKrw,
    access_period_days:
      values.accessMode === "period" ? values.accessPeriodDays : null,
    status: values.status,
    thumbnail_path: values.thumbnailPath || null,
    detail_path: values.detailPath || null,
    created_by: admin.userId,
    updated_by: admin.userId,
  });

  if (error) {
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

  revalidatePath("/admin");
  revalidatePath("/admin/products");
  revalidatePath("/admin/courses");
  revalidatePublicCatalog(values.slug);

  return {
    status: "success",
    message:
      values.productType === "course"
        ? `새 상품을 ${formatStatus(values.status)} 상태로 등록했습니다. 강의 관리의 연결 대기 목록에서 콘텐츠를 연결할 수 있습니다.`
        : `새 상품을 ${formatStatus(values.status)} 상태로 등록했습니다.`,
    fieldErrors: {},
  };
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

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "입력한 상품 정보를 다시 확인해 주세요.",
      fieldErrors,
    };
  }

  const supabase = await createClient();
  // slug는 수정 대상에서 제외한다: lesson_progress가 상품 slug를 텍스트 키로 참조하므로
  // 생성 후 불변 계약이다. slug 변경 필드를 이 수정 경로에 추가하지 말 것.
  const { data, error } = await supabase
    .from("products")
    .update({
      title: values.title,
      summary: values.summary,
      price_krw: values.priceKrw,
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
  productType: "course" | "ebook";
  title: string;
  slug: string;
  summary: string;
  priceKrw: number;
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
};

function readProductForm(formData: FormData): ProductFormValues {
  const productType = readString(formData, "productType");
  const accessMode = readString(formData, "accessMode");
  const status = readString(formData, "status");

  return {
    productType: productType === "ebook" ? "ebook" : "course",
    title: readString(formData, "title"),
    slug: readString(formData, "slug").toLowerCase(),
    summary: readString(formData, "summary"),
    priceKrw: readNumber(formData, "priceKrw"),
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
    priceKrw: readNumber(formData, "priceKrw"),
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

  if (!values.title || values.title.length > 120) {
    errors.title = "상품명은 1자 이상 120자 이하로 입력해 주세요.";
  }

  if (!Number.isInteger(values.priceKrw) || values.priceKrw < 0) {
    errors.priceKrw = "판매가는 0원 이상의 숫자로 입력해 주세요.";
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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function isSafeLocalPath(value: string) {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}

function formatStatus(status: AdminProductStatus) {
  const labels: Record<AdminProductStatus, string> = {
    draft: "작성 중",
    active: "판매 중",
    paused: "판매 중지",
    archived: "보관",
  };
  return labels[status];
}
