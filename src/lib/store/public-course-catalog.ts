import "server-only";

import { cache } from "react";
import { courses as fallbackCourses } from "@/lib/learning/catalog";
import type { Course, CourseLesson, CourseSection } from "@/lib/learning/types";
import { createPublicClient } from "@/lib/supabase/public";
import { courseProducts } from "./course-products";

export type PublicCourseCatalogItem = {
  productId: string;
  slug: string;
  title: string;
  summary: string;
  priceKrw: number;
  accessPeriodDays: number | null;
  accessLabel: string;
  thumbnailSrc: string | null;
  detailHref: string;
  checkoutHref: string;
  /** 판매 페이지에 표시하는 보관되지 않은 전체 커리큘럼 */
  course: Course;
  /** 강의실에서 사용하는 전체 목차. 공개 차시만 available이다. */
  classroomCourse: Course | null;
  outlineReady: boolean;
  contentReady: boolean;
  source: "database" | "catalog";
};

type ProductRow = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  price_krw: number;
  access_period_days: number | null;
  thumbnail_path: string | null;
  detail_path: string | null;
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
};

type SectionRow = {
  id: string;
  course_id: string;
  section_key: string;
  title: string;
  description: string;
  sort_order: number;
};

type LessonRow = {
  id: string;
  section_id: string;
  lesson_key: string;
  title: string;
  duration_seconds: number;
  sort_order: number;
};

type CourseOutlineRow = {
  product_id: string;
  course_id: string;
  course_slug: string;
  course_title: string;
  course_short_title: string;
  course_description: string;
  course_instructor: string;
  course_poster_path: string | null;
  course_status: "draft" | "published";
  section_id: string | null;
  section_key: string | null;
  section_title: string | null;
  section_description: string | null;
  section_sort_order: number | null;
  section_status: "draft" | "published" | null;
  lesson_key: string | null;
  lesson_title: string | null;
  lesson_duration_seconds: number | null;
  lesson_sort_order: number | null;
  lesson_status: "draft" | "published" | null;
};

export const loadPublicCourseCatalog = cache(async function loadPublicCourseCatalog(): Promise<PublicCourseCatalogItem[]> {
  const supabase = createPublicClient();
  const [productResult, outlineResult] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, slug, title, summary, price_krw, access_period_days, thumbnail_path, detail_path"
      )
      .eq("product_type", "course")
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .returns<ProductRow[]>(),
    loadCourseOutlines(supabase),
  ]);
  const { data: productRows, error: productError } = productResult;

  if (productError) {
    if (isMissingCatalogSchema(productError.code)) return buildFallbackCatalog();

    console.error("Failed to load public course products:", productError.message);
    return [];
  }

  const products = productRows ?? [];
  if (products.length === 0) return [];

  const publishedCourses = outlineResult.available
    ? outlineResult.courses.flatMap(({ productId, course, published }) =>
        published ? [{ productId, course }] : []
      )
    : await loadPublishedCourses(
        supabase,
        products.map((product) => product.id)
      );
  if (!publishedCourses) return [];

  const outlineByProductId = new Map(
    outlineResult.courses.map((course) => [course.productId, course.course])
  );
  const publishedCourseByProductId = new Map(
    publishedCourses.map((course) => [course.productId, course.course])
  );

  return products.flatMap((product) => {
    const publishedCourse = publishedCourseByProductId.get(product.id) ?? null;
    const fallbackOutline = fallbackCourses.find((course) => course.slug === product.slug);
    const course =
      outlineByProductId.get(product.id) ??
      publishedCourse ??
      (!outlineResult.available ? fallbackOutline : undefined) ??
      buildPlaceholderCourse(product);
    const classroomCourse = buildClassroomCourse(course, publishedCourse);

    return [
      mapProductRow(
        product,
        course,
        classroomCourse,
        outlineResult.available ? "database" : "catalog"
      ),
    ];
  });
});

export const loadPublicCourseBySlug = cache(async function loadPublicCourseBySlug(
  slug: string
): Promise<PublicCourseCatalogItem | null> {
  const catalog = await loadPublicCourseCatalog();
  return catalog.find((item) => item.slug === slug) ?? null;
});

async function loadPublishedCourses(
  supabase: ReturnType<typeof createPublicClient>,
  productIds: string[]
) {
  const { data: courseRows, error: courseError } = await supabase
    .from("courses")
    .select(
      "id, product_id, slug, title, short_title, description, instructor, poster_path"
    )
    .in("product_id", productIds)
    .eq("status", "published")
    .returns<CourseRow[]>();

  if (courseError) {
    console.error("Failed to load public courses:", courseError.message);
    return null;
  }
  if (!courseRows || courseRows.length === 0) return [];

  const courseIds = courseRows.map((course) => course.id);
  const { data: sectionRows, error: sectionError } = await supabase
    .from("course_sections")
    .select("id, course_id, section_key, title, description, sort_order")
    .in("course_id", courseIds)
    .eq("status", "published")
    .order("sort_order", { ascending: true })
    .returns<SectionRow[]>();

  if (sectionError) {
    console.error("Failed to load public course sections:", sectionError.message);
    return null;
  }

  const sections = sectionRows ?? [];
  const sectionIds = sections.map((section) => section.id);
  let lessons: LessonRow[] = [];

  if (sectionIds.length > 0) {
    const { data: lessonRows, error: lessonError } = await supabase
      .from("lessons")
      .select("id, section_id, lesson_key, title, duration_seconds, sort_order")
      .in("section_id", sectionIds)
      .eq("status", "published")
      .order("sort_order", { ascending: true })
      .returns<LessonRow[]>();

    if (lessonError) {
      console.error("Failed to load public course lessons:", lessonError.message);
      return null;
    }
    lessons = lessonRows ?? [];
  }

  const lessonsBySection = new Map<string, CourseLesson[]>();
  for (const lesson of lessons) {
    const current = lessonsBySection.get(lesson.section_id) ?? [];
    current.push({
      id: lesson.lesson_key,
      title: lesson.title,
      durationSeconds: lesson.duration_seconds,
    });
    lessonsBySection.set(lesson.section_id, current);
  }

  const sectionsByCourse = new Map<string, CourseSection[]>();
  for (const section of sections) {
    const current = sectionsByCourse.get(section.course_id) ?? [];
    current.push({
      id: section.section_key,
      title: section.title,
      description: section.description,
      lessons: lessonsBySection.get(section.id) ?? [],
    });
    sectionsByCourse.set(section.course_id, current);
  }

  return courseRows.map((course) => ({
    productId: course.product_id,
    course: {
      slug: course.slug,
      title: course.title,
      shortTitle: course.short_title,
      description: course.description,
      instructor: course.instructor,
      posterSrc: resolveLocalImage(course.poster_path, "") ?? "",
      sections: sectionsByCourse.get(course.id) ?? [],
    } satisfies Course,
  }));
}

async function loadCourseOutlines(
  supabase: ReturnType<typeof createPublicClient>
) {
  const { data, error } = await supabase.rpc("get_public_course_catalog_outline");

  if (error) {
    const unavailable =
      error.code === "42883" || error.code === "PGRST202" || error.code === "PGRST205";
    if (!unavailable) {
      console.error("Failed to load public course outlines:", error.message);
    }
    return {
      available: false as const,
      courses: [] as Array<{
        productId: string;
        course: Course;
        published: boolean;
      }>,
    };
  }

  const builders = new Map<
    string,
    {
      productId: string;
      course: Course;
      published: boolean;
      sectionById: Map<string, CourseSection>;
    }
  >();

  for (const row of (data ?? []) as unknown as CourseOutlineRow[]) {
    let builder = builders.get(row.course_id);
    if (!builder) {
      builder = {
        productId: row.product_id,
        published: row.course_status === "published",
        course: {
          slug: row.course_slug,
          title: row.course_title,
          shortTitle: row.course_short_title,
          description: row.course_description,
          instructor: row.course_instructor,
          posterSrc: resolveLocalImage(row.course_poster_path, "") ?? "",
          sections: [],
        },
        sectionById: new Map(),
      };
      builders.set(row.course_id, builder);
    }

    if (!row.section_id || !row.section_key || !row.section_title) continue;

    let section = builder.sectionById.get(row.section_id);
    if (!section) {
      section = {
        id: row.section_key,
        title: row.section_title,
        description: row.section_description ?? "",
        lessons: [],
      };
      builder.sectionById.set(row.section_id, section);
      builder.course.sections.push(section);
    }

    if (row.lesson_key && row.lesson_title) {
      section.lessons.push({
        id: row.lesson_key,
        title: row.lesson_title,
        durationSeconds: row.lesson_duration_seconds ?? 0,
        availability:
          row.course_status === "published" &&
          row.section_status === "published" &&
          row.lesson_status === "published"
            ? "available"
            : "coming-soon",
      });
    }
  }

  return {
    available: true as const,
    courses: Array.from(builders.values()).map(({ productId, course, published }) => ({
      productId,
      course,
      published,
    })),
  };
}

function mapProductRow(
  product: ProductRow,
  course: Course,
  classroomCourse: Course | null,
  source: PublicCourseCatalogItem["source"]
): PublicCourseCatalogItem {
  const availableLessonCount =
    classroomCourse?.sections.reduce(
      (total, section) =>
        total +
        section.lessons.filter((lesson) => lesson.availability !== "coming-soon").length,
      0
    ) ?? 0;

  return {
    productId: product.id,
    slug: product.slug,
    title: product.title,
    summary: product.summary || course.description,
    priceKrw: product.price_krw,
    accessPeriodDays: product.access_period_days,
    accessLabel: formatAccessPeriod(product.access_period_days),
    thumbnailSrc: resolveLocalImage(product.thumbnail_path, course.posterSrc),
    detailHref: resolveDetailHref(product.detail_path, product.slug),
    checkoutHref: `/checkout?product=${encodeURIComponent(product.slug)}`,
    course,
    classroomCourse,
    outlineReady: course.sections.length > 0,
    contentReady: availableLessonCount > 0,
    source,
  };
}

function buildFallbackCatalog(): PublicCourseCatalogItem[] {
  return courseProducts.flatMap((product, index) => {
    const course = fallbackCourses.find((item) => item.slug === product.courseSlug);
    if (!course) return [];
    const accessPeriodDays = readAccessPeriod(product.accessLabel);

    return [
      {
        productId: `catalog:${index}:${product.courseSlug}`,
        slug: product.courseSlug,
        title: course.title,
        summary: course.description || product.tagline,
        priceKrw: product.price,
        accessPeriodDays,
        accessLabel: formatAccessPeriod(accessPeriodDays),
        thumbnailSrc: course.posterSrc,
        detailHref: `/courses/${product.courseSlug}`,
        checkoutHref: `/checkout?product=${encodeURIComponent(product.courseSlug)}`,
        course,
        classroomCourse: course,
        outlineReady: course.sections.length > 0,
        contentReady: course.sections.length > 0,
        source: "catalog" as const,
      },
    ];
  });
}

function buildClassroomCourse(outline: Course, publishedCourse: Course | null) {
  if (!publishedCourse) return null;

  const publishedLessonIds = new Set(
    publishedCourse.sections.flatMap((section) =>
      section.lessons
        .filter((lesson) => lesson.availability !== "coming-soon")
        .map((lesson) => lesson.id)
    )
  );

  return {
    ...outline,
    sections: outline.sections.map((section) => ({
      ...section,
      lessons: section.lessons.map((lesson) => ({
        ...lesson,
        availability: publishedLessonIds.has(lesson.id)
          ? ("available" as const)
          : ("coming-soon" as const),
      })),
    })),
  } satisfies Course;
}

function buildPlaceholderCourse(product: ProductRow): Course {
  return {
    slug: product.slug,
    title: product.title,
    shortTitle: product.title,
    description: product.summary,
    instructor: "",
    posterSrc: "",
    sections: [],
  };
}

function resolveLocalImage(
  value: string | null | undefined,
  fallback: string | null
) {
  if (value?.startsWith("/")) return value;
  return fallback?.startsWith("/") ? fallback : null;
}

function resolveDetailHref(value: string | null, slug: string) {
  const fallback = `/courses/${slug}`;
  if (!value || value === "/courses") return fallback;
  return value.startsWith("/") ? value : fallback;
}

function formatAccessPeriod(days: number | null) {
  return days === null ? "기간 제한 없이 수강" : `${days}일 수강`;
}

function readAccessPeriod(label: string) {
  const matchedDays = label.match(/(\d+)일/);
  return matchedDays ? Number(matchedDays[1]) : null;
}

function isMissingCatalogSchema(code: string) {
  return code === "42P01" || code === "PGRST205";
}
