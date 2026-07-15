import "server-only";

import { requireAdmin } from "@/lib/admin/auth";
import { courses as catalogCourses } from "@/lib/learning/catalog";
import { courseProducts } from "@/lib/store/course-products";
import { createClient } from "@/lib/supabase/server";

export type AdminCourseStatus = "draft" | "published" | "archived";

export type AdminLesson = {
  id: string;
  key: string;
  title: string;
  durationSeconds: number;
  videoPath: string | null;
  videoProvider: "local" | "supabase" | null;
  videoFileName: string | null;
  videoContentType: string | null;
  videoSizeBytes: number | null;
  videoUploadedAt: string | null;
  status: AdminCourseStatus;
  isPreview: boolean;
  sortOrder: number;
  updatedAt: string | null;
};

export type AdminCourseSection = {
  id: string;
  key: string;
  title: string;
  description: string;
  status: AdminCourseStatus;
  sortOrder: number;
  updatedAt: string | null;
  lessons: AdminLesson[];
};

export type AdminCourse = {
  id: string;
  productId: string;
  productTitle: string;
  productStatus: "draft" | "active" | "paused" | "archived";
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  instructor: string;
  posterPath: string | null;
  status: AdminCourseStatus;
  updatedAt: string | null;
  source: "database" | "catalog";
  sections: AdminCourseSection[];
};

export type CourseProductOption = {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "active" | "paused" | "archived";
};

export type AdminCoursesResult = {
  courses: AdminCourse[];
  availableProducts: CourseProductOption[];
  databaseReady: boolean;
  videoStorageReady: boolean;
  message: string | null;
};

type CourseRow = {
  id: string;
  product_id: string;
  slug: string;
  title: string;
  short_title: string;
  description: string;
  instructor: string;
  poster_path: string | null;
  status: AdminCourseStatus;
  updated_at: string;
};

type SectionRow = {
  id: string;
  course_id: string;
  section_key: string;
  title: string;
  description: string;
  status: AdminCourseStatus;
  sort_order: number;
  updated_at: string;
};

type LessonRow = {
  id: string;
  section_id: string;
  lesson_key: string;
  title: string;
  duration_seconds: number;
  video_path: string | null;
  video_provider: "local" | "supabase" | null;
  video_file_name: string | null;
  video_content_type: string | null;
  video_size_bytes: number | null;
  video_uploaded_at: string | null;
  status: AdminCourseStatus;
  is_preview: boolean;
  sort_order: number;
  updated_at: string;
};

type ProductRow = {
  id: string;
  slug: string;
  title: string;
  status: CourseProductOption["status"];
};

export async function loadAdminCourses(): Promise<AdminCoursesResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { data: productRows, error: productError } = await supabase
    .from("products")
    .select("id, slug, title, status")
    .eq("product_type", "course")
    .order("updated_at", { ascending: false })
    .returns<ProductRow[]>();

  if (productError) {
    return fallbackResult(productError.code, productError.message);
  }

  const products = productRows ?? [];
  const { data: courseRows, error: courseError } = await supabase
    .from("courses")
    .select(
      "id, product_id, slug, title, short_title, description, instructor, poster_path, status, updated_at"
    )
    .order("updated_at", { ascending: false })
    .returns<CourseRow[]>();

  if (courseError) {
    return fallbackResult(courseError.code, courseError.message, products);
  }

  const courses = courseRows ?? [];
  const courseIds = courses.map((course) => course.id);
  let sectionRows: SectionRow[] = [];
  let lessonRows: LessonRow[] = [];
  let videoStorageReady = true;

  if (courseIds.length > 0) {
    const { data, error } = await supabase
      .from("course_sections")
      .select(
        "id, course_id, section_key, title, description, status, sort_order, updated_at"
      )
      .in("course_id", courseIds)
      .order("sort_order", { ascending: true })
      .returns<SectionRow[]>();

    if (error) return fallbackResult(error.code, error.message, products);
    sectionRows = data ?? [];
  }

  const sectionIds = sectionRows.map((section) => section.id);
  if (sectionIds.length > 0) {
    const expandedResult = await supabase
      .from("lessons")
      .select(
        "id, section_id, lesson_key, title, duration_seconds, video_path, video_provider, video_file_name, video_content_type, video_size_bytes, video_uploaded_at, status, is_preview, sort_order, updated_at"
      )
      .in("section_id", sectionIds)
      .order("sort_order", { ascending: true })
      .returns<LessonRow[]>();

    if (expandedResult.error && isVideoStorageSchemaMissing(expandedResult.error.code)) {
      videoStorageReady = false;
      const legacyResult = await supabase
        .from("lessons")
        .select(
          "id, section_id, lesson_key, title, duration_seconds, video_path, status, is_preview, sort_order, updated_at"
        )
        .in("section_id", sectionIds)
        .order("sort_order", { ascending: true })
        .returns<LegacyLessonRow[]>();

      if (legacyResult.error) {
        return fallbackResult(legacyResult.error.code, legacyResult.error.message, products);
      }
      lessonRows = (legacyResult.data ?? []).map(normalizeLegacyLesson);
    } else {
      if (expandedResult.error) {
        return fallbackResult(
          expandedResult.error.code,
          expandedResult.error.message,
          products
        );
      }
      lessonRows = expandedResult.data ?? [];
    }
  }

  const productById = new Map(products.map((product) => [product.id, product]));
  const lessonsBySection = new Map<string, AdminLesson[]>();
  const sectionsByCourse = new Map<string, AdminCourseSection[]>();

  for (const lesson of lessonRows) {
    const current = lessonsBySection.get(lesson.section_id) ?? [];
    current.push(mapLesson(lesson));
    lessonsBySection.set(lesson.section_id, current);
  }

  for (const section of sectionRows) {
    const mappedSection: AdminCourseSection = {
      id: section.id,
      key: section.section_key,
      title: section.title,
      description: section.description,
      status: section.status,
      sortOrder: section.sort_order,
      updatedAt: section.updated_at,
      lessons: lessonsBySection.get(section.id) ?? [],
    };
    const current = sectionsByCourse.get(section.course_id) ?? [];
    current.push(mappedSection);
    sectionsByCourse.set(section.course_id, current);
  }

  const mappedCourses = courses.map((course): AdminCourse => {
    const product = productById.get(course.product_id);
    return {
      id: course.id,
      productId: course.product_id,
      productTitle: product?.title ?? "연결 상품 확인 필요",
      productStatus: product?.status ?? "draft",
      slug: course.slug,
      title: course.title,
      shortTitle: course.short_title,
      description: course.description,
      instructor: course.instructor,
      posterPath: course.poster_path,
      status: course.status,
      updatedAt: course.updated_at,
      source: "database",
      sections: sectionsByCourse.get(course.id) ?? [],
    };
  });
  const linkedProductIds = new Set(courses.map((course) => course.product_id));

  return {
    courses: mappedCourses,
    availableProducts: products.filter(
      (product) => !linkedProductIds.has(product.id)
    ),
    databaseReady: true,
    videoStorageReady,
    message: null,
  };
}

function mapLesson(lesson: LessonRow): AdminLesson {
  return {
    id: lesson.id,
    key: lesson.lesson_key,
    title: lesson.title,
    durationSeconds: lesson.duration_seconds,
    videoPath: lesson.video_path,
    videoProvider: lesson.video_provider,
    videoFileName: lesson.video_file_name,
    videoContentType: lesson.video_content_type,
    videoSizeBytes: lesson.video_size_bytes,
    videoUploadedAt: lesson.video_uploaded_at,
    status: lesson.status,
    isPreview: lesson.is_preview,
    sortOrder: lesson.sort_order,
    updatedAt: lesson.updated_at,
  };
}

function fallbackResult(
  errorCode: string,
  errorMessage: string,
  products: ProductRow[] = []
): AdminCoursesResult {
  const tableMissing = errorCode === "42P01" || errorCode === "PGRST205";

  if (!tableMissing) {
    console.error("Failed to load admin courses:", errorMessage);
  }

  return {
    courses: buildCatalogFallback(),
    availableProducts: products.filter(
      (product) =>
        !catalogCourses.some((course) => course.slug === product.slug)
    ),
    databaseReady: false,
    videoStorageReady: false,
    message: tableMissing
      ? "현재 강의 관리 기능을 준비하고 있습니다. 잠시 후 다시 확인해 주세요."
      : "강의 정보를 불러오지 못했습니다. 잠시 후 페이지를 새로고침해 주세요.",
  };
}

function buildCatalogFallback(): AdminCourse[] {
  return catalogCourses.map((course) => {
    const product = courseProducts.find((item) => item.courseSlug === course.slug);
    const allLessons = course.sections.flatMap((section) => section.lessons);
    const contentReady =
      allLessons.length > 0 && allLessons.every((lesson) => lesson.videoSrc);

    return {
      id: `catalog:${course.slug}`,
      productId: `catalog-product:${course.slug}`,
      productTitle: course.title,
      productStatus: product ? "active" : "draft",
      slug: course.slug,
      title: course.title,
      shortTitle: course.shortTitle,
      description: course.description,
      instructor: course.instructor,
      posterPath: course.posterSrc,
      status: contentReady ? "published" : "draft",
      updatedAt: null,
      source: "catalog",
      sections: course.sections.map((section, sectionIndex) => ({
        id: `catalog:${course.slug}:${section.id}`,
        key: section.id,
        title: section.title,
        description: section.description,
        status: "published",
        sortOrder: sectionIndex + 1,
        updatedAt: null,
        lessons: section.lessons.map((lesson, lessonIndex) => ({
          id: `catalog:${course.slug}:${section.id}:${lesson.id}`,
          key: lesson.id,
          title: lesson.title,
          durationSeconds: lesson.durationSeconds,
          videoPath: lesson.videoSrc ?? null,
          videoProvider: lesson.videoSrc ? "local" : null,
          videoFileName: lesson.videoSrc?.split("/").at(-1) ?? null,
          videoContentType: lesson.videoSrc ? "video/mp4" : null,
          videoSizeBytes: null,
          videoUploadedAt: null,
          status: lesson.videoSrc ? "published" : "draft",
          isPreview: false,
          sortOrder: lessonIndex + 1,
          updatedAt: null,
        })),
      })),
    };
  });
}

type LegacyLessonRow = Omit<
  LessonRow,
  | "video_provider"
  | "video_file_name"
  | "video_content_type"
  | "video_size_bytes"
  | "video_uploaded_at"
>;

function normalizeLegacyLesson(lesson: LegacyLessonRow): LessonRow {
  return {
    ...lesson,
    video_provider: lesson.video_path
      ? lesson.video_path.startsWith("/")
        ? "local"
        : "supabase"
      : null,
    video_file_name: lesson.video_path?.split("/").at(-1) ?? null,
    video_content_type: lesson.video_path ? "video/mp4" : null,
    video_size_bytes: null,
    video_uploaded_at: null,
  };
}

function isVideoStorageSchemaMissing(code: string) {
  return code === "42703" || code === "PGRST204";
}
