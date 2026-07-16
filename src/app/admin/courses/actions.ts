"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import type { AdminCourseStatus, AdminLesson } from "@/lib/admin/courses";
import { createClient } from "@/lib/supabase/server";

type CourseField =
  | "productId"
  | "title"
  | "shortTitle"
  | "description"
  | "instructor"
  | "posterPath"
  | "status"
  | "sectionKey"
  | "lessonKey"
  | "durationSeconds";

export type CourseFormState = {
  status: "idle" | "error" | "success";
  message: string;
  fieldErrors: Partial<Record<CourseField, string>>;
  createdLesson?: AdminLesson;
};

export type CourseMutationResult = {
  ok: boolean;
  message: string;
};

export type LessonVideoFinalizeInput = {
  objectPath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  durationSeconds: number;
};

const courseVideoBucket = "course-videos";
const maxCourseVideoBytes = 50 * 1024 * 1024;

const contentStatuses: AdminCourseStatus[] = [
  "draft",
  "published",
  "archived",
];

export async function createCourseAction(
  _previousState: CourseFormState,
  formData: FormData
): Promise<CourseFormState> {
  const admin = await requireAdmin();
  const productId = readString(formData, "productId");
  const values = readCourseForm(formData);
  const fieldErrors = validateCourseForm(values);

  if (!isUuid(productId)) {
    fieldErrors.productId = "연결할 강의 상품을 선택해 주세요.";
  }
  if (hasErrors(fieldErrors)) return formError(fieldErrors);

  const supabase = await createClient();
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, slug, product_type")
    .eq("id", productId)
    .maybeSingle<{ id: string; slug: string; product_type: string }>();

  if (productError || !product || product.product_type !== "course") {
    return {
      status: "error",
      message: "연결 가능한 강의 상품을 찾지 못했습니다.",
      fieldErrors: { productId: "상품 관리에서 강의 상품을 먼저 확인해 주세요." },
    };
  }

  const { error } = await supabase.from("courses").insert({
    product_id: product.id,
    slug: product.slug,
    title: values.title,
    short_title: values.shortTitle,
    description: values.description,
    instructor: values.instructor,
    poster_path: values.posterPath || null,
    status: "draft",
    created_by: admin.userId,
    updated_by: admin.userId,
  });

  if (error) {
    console.error("Failed to create course:", error.message);
    return mutationError(error.code, "강의를 만들지 못했습니다.");
  }

  revalidateCourses();
  return success("새 강의를 작성 중 상태로 만들었습니다.");
}

export async function updateCourseAction(
  courseId: string,
  _previousState: CourseFormState,
  formData: FormData
): Promise<CourseFormState> {
  await requireAdmin();
  if (!isUuid(courseId)) return invalidTarget("수정할 강의를 확인해 주세요.");

  const values = readCourseForm(formData);
  const fieldErrors = validateCourseForm(values);
  if (hasErrors(fieldErrors)) return formError(fieldErrors);

  const supabase = await createClient();
  if (values.status === "published") {
    const publishError = await validateCoursePublishReadiness(supabase, courseId);
    if (publishError) {
      return {
        status: "error",
        message: publishError,
        fieldErrors: { status: publishError },
      };
    }
  }

  const { data, error } = await supabase
    .from("courses")
    .update({
      title: values.title,
      short_title: values.shortTitle,
      description: values.description,
      instructor: values.instructor,
      poster_path: values.posterPath || null,
      status: values.status,
    })
    .eq("id", courseId)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !data) {
    if (error) console.error("Failed to update course:", error.message);
    return mutationError(error?.code, "강의 정보를 수정하지 못했습니다.");
  }

  revalidateCourses();
  return success("강의 기본 정보를 수정했습니다.");
}

export async function createCourseSectionAction(
  courseId: string,
  _previousState: CourseFormState,
  formData: FormData
): Promise<CourseFormState> {
  const admin = await requireAdmin();
  if (!isUuid(courseId)) return invalidTarget("챕터를 추가할 강의를 확인해 주세요.");

  const values = readSectionForm(formData);
  const fieldErrors = validateSectionForm(values);
  if (hasErrors(fieldErrors)) return formError(fieldErrors);

  const supabase = await createClient();
  const { data: lastSection, error: orderError } = await supabase
    .from("course_sections")
    .select("sort_order")
    .eq("course_id", courseId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();

  if (orderError) return mutationError(orderError.code, "챕터 순서를 확인하지 못했습니다.");

  const { error } = await supabase.from("course_sections").insert({
    course_id: courseId,
    section_key: values.key,
    title: values.title,
    description: values.description,
    status: values.status,
    sort_order: (lastSection?.sort_order ?? 0) + 1,
    created_by: admin.userId,
    updated_by: admin.userId,
  });

  if (error) {
    console.error("Failed to create course section:", error.message);
    if (error.code === "23505") {
      return {
        status: "error",
        message: "이미 사용 중인 챕터 키입니다.",
        fieldErrors: { sectionKey: "다른 챕터 키를 입력해 주세요." },
      };
    }
    return mutationError(error.code, "챕터를 추가하지 못했습니다.");
  }

  revalidateCourses();
  return success("새 챕터를 커리큘럼 마지막에 추가했습니다.");
}

export async function updateCourseSectionAction(
  sectionId: string,
  _previousState: CourseFormState,
  formData: FormData
): Promise<CourseFormState> {
  await requireAdmin();
  if (!isUuid(sectionId)) return invalidTarget("수정할 챕터를 확인해 주세요.");

  const values = readSectionForm(formData, false);
  const fieldErrors = validateSectionForm(values, false);
  if (hasErrors(fieldErrors)) return formError(fieldErrors);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("course_sections")
    .update({
      title: values.title,
      description: values.description,
      status: values.status,
    })
    .eq("id", sectionId)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !data) {
    if (error) console.error("Failed to update course section:", error.message);
    return mutationError(error?.code, "챕터를 수정하지 못했습니다.");
  }

  revalidateCourses();
  return success("챕터 정보를 수정했습니다.");
}

export async function createLessonAction(
  sectionId: string,
  _previousState: CourseFormState,
  formData: FormData
): Promise<CourseFormState> {
  const admin = await requireAdmin();
  if (!isUuid(sectionId)) return invalidTarget("차시를 추가할 챕터를 확인해 주세요.");

  const values = readLessonForm(formData);
  const fieldErrors = validateLessonForm(values);
  if (values.status === "published") {
    fieldErrors.status = "차시를 먼저 만든 뒤 영상을 업로드해야 공개할 수 있습니다.";
  }
  if (hasErrors(fieldErrors)) return formError(fieldErrors);

  const supabase = await createClient();
  const { data: lastLesson, error: orderError } = await supabase
    .from("lessons")
    .select("sort_order")
    .eq("section_id", sectionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();

  if (orderError) return mutationError(orderError.code, "차시 순서를 확인하지 못했습니다.");

  const { data: createdLesson, error } = await supabase
    .from("lessons")
    .insert({
      section_id: sectionId,
      lesson_key: values.key,
      title: values.title,
      duration_seconds: values.durationSeconds,
      video_path: null,
      status: values.status,
      is_preview: values.isPreview,
      sort_order: (lastLesson?.sort_order ?? 0) + 1,
      created_by: admin.userId,
      updated_by: admin.userId,
    })
    .select(
      "id, lesson_key, title, duration_seconds, status, is_preview, sort_order, updated_at"
    )
    .single<{
      id: string;
      lesson_key: string;
      title: string;
      duration_seconds: number;
      status: AdminCourseStatus;
      is_preview: boolean;
      sort_order: number;
      updated_at: string;
    }>();

  if (error || !createdLesson) {
    if (error) console.error("Failed to create lesson:", error.message);
    if (error?.code === "23505") {
      return {
        status: "error",
        message: "이미 사용 중인 차시 키입니다.",
        fieldErrors: { lessonKey: "다른 차시 키를 입력해 주세요." },
      };
    }
    return mutationError(error?.code, "차시를 추가하지 못했습니다.");
  }

  revalidateCourses();
  return success("새 차시를 챕터 마지막에 추가했습니다.", {
    id: createdLesson.id,
    key: createdLesson.lesson_key,
    title: createdLesson.title,
    durationSeconds: createdLesson.duration_seconds,
    videoPath: null,
    videoProvider: null,
    videoFileName: null,
    videoContentType: null,
    videoSizeBytes: null,
    videoUploadedAt: null,
    status: createdLesson.status,
    isPreview: createdLesson.is_preview,
    sortOrder: createdLesson.sort_order,
    updatedAt: createdLesson.updated_at,
  });
}

export async function updateLessonAction(
  lessonId: string,
  _previousState: CourseFormState,
  formData: FormData
): Promise<CourseFormState> {
  await requireAdmin();
  if (!isUuid(lessonId)) return invalidTarget("수정할 차시를 확인해 주세요.");

  // withKey=false: lesson_key는 lesson_progress가 텍스트 키로 참조하므로 생성 후 불변 계약이다.
  // 수정 경로에서는 차시 키를 읽지도 바꾸지도 않는다. lesson_key 수정 필드를 추가하지 말 것.
  const values = readLessonForm(formData, false);
  const fieldErrors = validateLessonForm(values, false);
  if (hasErrors(fieldErrors)) return formError(fieldErrors);

  const supabase = await createClient();
  if (values.status === "published") {
    const { data: currentLesson, error: currentLessonError } = await supabase
      .from("lessons")
      .select("video_path")
      .eq("id", lessonId)
      .maybeSingle<{ video_path: string | null }>();

    if (currentLessonError || !currentLesson?.video_path) {
      return {
        status: "error",
        message: "영상을 업로드한 뒤 차시를 공개해 주세요.",
        fieldErrors: { status: "공개 상태에는 재생 가능한 영상이 필요합니다." },
      };
    }
  }

  const { data, error } = await supabase
    .from("lessons")
    .update({
      title: values.title,
      duration_seconds: values.durationSeconds,
      status: values.status,
      is_preview: values.isPreview,
    })
    .eq("id", lessonId)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !data) {
    if (error) console.error("Failed to update lesson:", error.message);
    return mutationError(error?.code, "차시를 수정하지 못했습니다.");
  }

  revalidateCourses();
  return success("차시 정보를 수정했습니다.");
}

export async function finalizeLessonVideoAction(
  lessonId: string,
  input: LessonVideoFinalizeInput
): Promise<CourseMutationResult> {
  await requireAdmin();
  if (!isUuid(lessonId)) {
    return { ok: false, message: "영상을 연결할 차시를 확인해 주세요." };
  }

  const validationMessage = validateVideoFinalizeInput(lessonId, input);
  if (validationMessage) return { ok: false, message: validationMessage };

  const supabase = await createClient();
  const { data: currentLesson, error: lessonError } = await supabase
    .from("lessons")
    .select("video_path, video_provider")
    .eq("id", lessonId)
    .maybeSingle<{ video_path: string | null; video_provider: string | null }>();

  if (lessonError || !currentLesson) {
    await removeUploadedVideo(supabase, input.objectPath);
    return { ok: false, message: "영상을 연결할 차시를 찾지 못했습니다." };
  }

  const folderPath = input.objectPath.slice(0, input.objectPath.lastIndexOf("/"));
  const objectName = input.objectPath.slice(input.objectPath.lastIndexOf("/") + 1);
  const { data: uploadedObjects, error: storageError } = await supabase.storage
    .from(courseVideoBucket)
    .list(folderPath, { limit: 20, search: objectName });

  if (storageError || !uploadedObjects?.some((item) => item.name === objectName)) {
    await removeUploadedVideo(supabase, input.objectPath);
    return {
      ok: false,
      message: "업로드된 영상을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  const uploadedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("lessons")
    .update({
      video_path: input.objectPath,
      video_provider: "supabase",
      video_file_name: input.fileName,
      video_content_type: input.contentType,
      video_size_bytes: Math.round(input.sizeBytes),
      video_uploaded_at: uploadedAt,
      duration_seconds: Math.max(1, Math.round(input.durationSeconds)),
    })
    .eq("id", lessonId);

  if (updateError) {
    console.error("Failed to connect lesson video:", updateError.message);
    await removeUploadedVideo(supabase, input.objectPath);
    return videoMutationError(updateError.code, "영상을 차시에 연결하지 못했습니다.");
  }

  if (
    currentLesson.video_provider === "supabase" &&
    currentLesson.video_path &&
    currentLesson.video_path !== input.objectPath
  ) {
    const { error: cleanupError } = await supabase.storage
      .from(courseVideoBucket)
      .remove([currentLesson.video_path]);
    if (cleanupError) {
      console.error("Failed to remove replaced lesson video:", cleanupError.message);
    }
  }

  revalidateCourses();
  return { ok: true, message: "영상 업로드와 차시 연결을 완료했습니다." };
}

export async function removeLessonVideoAction(
  lessonId: string
): Promise<CourseMutationResult> {
  await requireAdmin();
  if (!isUuid(lessonId)) {
    return { ok: false, message: "영상을 삭제할 차시를 확인해 주세요." };
  }

  const supabase = await createClient();
  const { data: lesson, error: lessonError } = await supabase
    .from("lessons")
    .select("video_path, video_provider, status")
    .eq("id", lessonId)
    .maybeSingle<{
      video_path: string | null;
      video_provider: string | null;
      status: AdminCourseStatus;
    }>();

  if (lessonError || !lesson) {
    return { ok: false, message: "삭제할 영상 정보를 찾지 못했습니다." };
  }

  const { error: updateError } = await supabase
    .from("lessons")
    .update({
      video_path: null,
      video_provider: null,
      video_file_name: null,
      video_content_type: null,
      video_size_bytes: null,
      video_uploaded_at: null,
      status: lesson.status === "published" ? "draft" : lesson.status,
    })
    .eq("id", lessonId);

  if (updateError) {
    console.error("Failed to disconnect lesson video:", updateError.message);
    return videoMutationError(updateError.code, "영상을 삭제하지 못했습니다.");
  }

  if (lesson.video_provider === "supabase" && lesson.video_path) {
    const { error: storageError } = await supabase.storage
      .from(courseVideoBucket)
      .remove([lesson.video_path]);
    if (storageError) {
      console.error("Failed to remove lesson video object:", storageError.message);
      return {
        ok: true,
        message: "차시 연결은 해제했습니다. 저장 파일 정리는 다시 시도해 주세요.",
      };
    }
  }

  revalidateCourses();
  return { ok: true, message: "차시에서 영상을 삭제했습니다." };
}

export async function moveCourseContentAction(
  kind: "section" | "lesson",
  itemId: string,
  direction: -1 | 1
): Promise<CourseMutationResult> {
  await requireAdmin();
  if (!isUuid(itemId) || ![-1, 1].includes(direction)) {
    return { ok: false, message: "이동할 항목과 방향을 확인해 주세요." };
  }

  const supabase = await createClient();
  const functionName = kind === "section" ? "move_course_section" : "move_lesson";
  const args =
    kind === "section"
      ? { target_section_id: itemId, move_direction: direction }
      : { target_lesson_id: itemId, move_direction: direction };
  const { error } = await supabase.rpc(functionName, args);

  if (error) {
    console.error(`Failed to move ${kind}:`, error.message);
    return { ok: false, message: "순서를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  revalidateCourses();
  return { ok: true, message: "커리큘럼 순서를 변경했습니다." };
}

type CourseValues = {
  title: string;
  shortTitle: string;
  description: string;
  instructor: string;
  posterPath: string;
  status: AdminCourseStatus;
};

type SectionValues = {
  key: string;
  title: string;
  description: string;
  status: AdminCourseStatus;
};

type LessonValues = {
  key: string;
  title: string;
  durationSeconds: number;
  status: AdminCourseStatus;
  isPreview: boolean;
};

function readCourseForm(formData: FormData): CourseValues {
  return {
    title: readString(formData, "title"),
    shortTitle: readString(formData, "shortTitle"),
    description: readString(formData, "description"),
    instructor: readString(formData, "instructor"),
    posterPath: readString(formData, "posterPath"),
    status: readStatus(formData),
  };
}

function readSectionForm(formData: FormData, withKey = true): SectionValues {
  return {
    key: withKey ? readString(formData, "sectionKey").toLowerCase() : "existing",
    title: readString(formData, "title"),
    description: readString(formData, "description"),
    status: readStatus(formData),
  };
}

function readLessonForm(formData: FormData, withKey = true): LessonValues {
  return {
    key: withKey ? readString(formData, "lessonKey").toLowerCase() : "existing",
    title: readString(formData, "title"),
    durationSeconds: readNumber(formData, "durationSeconds"),
    status: readStatus(formData),
    isPreview: formData.get("isPreview") === "on",
  };
}

function validateCourseForm(values: CourseValues) {
  const errors: CourseFormState["fieldErrors"] = {};
  if (!values.title || values.title.length > 120) {
    errors.title = "강의명은 1자 이상 120자 이하로 입력해 주세요.";
  }
  if (!values.shortTitle || values.shortTitle.length > 80) {
    errors.shortTitle = "짧은 강의명은 1자 이상 80자 이하로 입력해 주세요.";
  }
  if (values.description.length > 1000) {
    errors.description = "강의 소개는 1,000자 이하로 입력해 주세요.";
  }
  if (values.instructor.length > 80) {
    errors.instructor = "강사명은 80자 이하로 입력해 주세요.";
  }
  if (values.posterPath && !isSafeLocalPath(values.posterPath)) {
    errors.posterPath = "사이트 내부 이미지 경로를 /로 시작해 입력해 주세요.";
  }
  return errors;
}

function validateSectionForm(values: SectionValues, withKey = true) {
  const errors: CourseFormState["fieldErrors"] = {};
  if (withKey && !isKey(values.key)) {
    errors.sectionKey = "영문 소문자, 숫자와 하이픈만 사용할 수 있습니다.";
  }
  if (!values.title || values.title.length > 120) {
    errors.title = "챕터명은 1자 이상 120자 이하로 입력해 주세요.";
  }
  if (values.description.length > 500) {
    errors.description = "챕터 설명은 500자 이하로 입력해 주세요.";
  }
  return errors;
}

function validateLessonForm(values: LessonValues, withKey = true) {
  const errors: CourseFormState["fieldErrors"] = {};
  if (withKey && !isKey(values.key)) {
    errors.lessonKey = "영문 소문자, 숫자와 하이픈만 사용할 수 있습니다.";
  }
  if (!values.title || values.title.length > 180) {
    errors.title = "차시명은 1자 이상 180자 이하로 입력해 주세요.";
  }
  if (!Number.isInteger(values.durationSeconds) || values.durationSeconds < 0) {
    errors.durationSeconds = "영상 길이는 0초 이상의 숫자로 입력해 주세요.";
  }
  return errors;
}

async function validateCoursePublishReadiness(
  supabase: Awaited<ReturnType<typeof createClient>>,
  courseId: string
) {
  const { data: sections, error: sectionError } = await supabase
    .from("course_sections")
    .select("id")
    .eq("course_id", courseId)
    .eq("status", "published")
    .returns<Array<{ id: string }>>();

  if (sectionError) return "강의 공개 준비 상태를 확인하지 못했습니다.";
  if (!sections || sections.length === 0) return "공개할 챕터를 먼저 추가해 주세요.";

  const { data: lessons, error: lessonError } = await supabase
    .from("lessons")
    .select("video_path")
    .in("section_id", sections.map((section) => section.id))
    .eq("status", "published")
    .returns<Array<{ video_path: string | null }>>();

  if (lessonError) return "차시 공개 준비 상태를 확인하지 못했습니다.";
  if (!lessons || lessons.length === 0) return "공개할 차시를 먼저 추가해 주세요.";
  if (lessons.some((lesson) => !lesson.video_path)) {
    return "영상이 연결되지 않은 차시가 있어 강의를 공개할 수 없습니다.";
  }
  return null;
}

function readStatus(formData: FormData): AdminCourseStatus {
  const value = readString(formData, "status") as AdminCourseStatus;
  return contentStatuses.includes(value) ? value : "draft";
}

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(formData: FormData, key: string) {
  const value = Number(readString(formData, key));
  return Number.isFinite(value) ? value : Number.NaN;
}

function isKey(value: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isSafeLocalPath(value: string) {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function hasErrors(errors: CourseFormState["fieldErrors"]) {
  return Object.keys(errors).length > 0;
}

function formError(fieldErrors: CourseFormState["fieldErrors"]): CourseFormState {
  return {
    status: "error",
    message: "입력한 정보를 다시 확인해 주세요.",
    fieldErrors,
  };
}

function success(
  message: string,
  createdLesson?: AdminLesson
): CourseFormState {
  return { status: "success", message, fieldErrors: {}, createdLesson };
}

function invalidTarget(message: string): CourseFormState {
  return { status: "error", message, fieldErrors: {} };
}

function mutationError(code: string | undefined, message: string): CourseFormState {
  const databaseMissing = code === "42P01" || code === "PGRST205";
  return {
    status: "error",
    message: databaseMissing
      ? "현재 강의 관리 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."
      : `${message} 잠시 후 다시 시도해 주세요.`,
    fieldErrors: {},
  };
}

function validateVideoFinalizeInput(
  lessonId: string,
  input: LessonVideoFinalizeInput
) {
  if (
    typeof input.objectPath !== "string" ||
    !new RegExp(`^lessons/${lessonId}/[0-9a-f-]{36}\\.mp4$`, "i").test(
      input.objectPath
    )
  ) {
    return "업로드된 영상 경로가 올바르지 않습니다.";
  }
  if (
    typeof input.fileName !== "string" ||
    !input.fileName.trim() ||
    input.fileName.length > 255
  ) {
    return "영상 파일명을 확인해 주세요.";
  }
  if (input.contentType !== "video/mp4") {
    return "현재는 MP4 영상만 업로드할 수 있습니다.";
  }
  if (
    !Number.isFinite(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > maxCourseVideoBytes
  ) {
    return "영상은 50MB 이하의 MP4 파일로 업로드해 주세요.";
  }
  if (
    !Number.isFinite(input.durationSeconds) ||
    input.durationSeconds <= 0 ||
    input.durationSeconds > 12 * 60 * 60
  ) {
    return "영상 재생 시간을 확인하지 못했습니다.";
  }
  return null;
}

function videoMutationError(
  code: string | undefined,
  message: string
): CourseMutationResult {
  const storageUnavailable =
    code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205";
  return {
    ok: false,
    message: storageUnavailable
      ? "현재 영상 저장 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."
      : `${message} 잠시 후 다시 시도해 주세요.`,
  };
}

async function removeUploadedVideo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  objectPath: string
) {
  const { error } = await supabase.storage
    .from(courseVideoBucket)
    .remove([objectPath]);
  if (error) console.error("Failed to clean up uploaded video:", error.message);
}

function revalidateCourses() {
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/courses");
  revalidatePath("/courses");
  revalidatePath("/courses/[slug]", "page");
  revalidatePath("/checkout");
  revalidatePath("/learn", "layout");
  revalidatePath("/my");
}
