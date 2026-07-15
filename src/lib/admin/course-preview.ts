import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Course, CourseLesson, CourseSection } from "@/lib/learning/types";

type PreviewCourseRow = {
  id: string;
  slug: string;
  title: string;
  short_title: string;
  description: string;
  instructor: string;
  poster_path: string | null;
};

type PreviewSectionRow = {
  id: string;
  section_key: string;
  title: string;
  description: string;
  sort_order: number;
};

type PreviewLessonRow = {
  section_id: string;
  lesson_key: string;
  title: string;
  duration_seconds: number;
  sort_order: number;
};

/** 관리자 RLS로 작성 중 강의까지 읽어 실제 강의실 형태로 검수한다. */
export async function loadAdminCoursePreview(
  supabase: SupabaseClient,
  courseSlug: string
): Promise<Course | null> {
  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id, slug, title, short_title, description, instructor, poster_path")
    .eq("slug", courseSlug)
    .maybeSingle<PreviewCourseRow>();

  if (courseError || !course) {
    if (courseError) console.error("Failed to load admin course preview:", courseError.message);
    return null;
  }

  const { data: sections, error: sectionError } = await supabase
    .from("course_sections")
    .select("id, section_key, title, description, sort_order")
    .eq("course_id", course.id)
    .neq("status", "archived")
    .order("sort_order", { ascending: true })
    .returns<PreviewSectionRow[]>();

  if (sectionError) {
    console.error("Failed to load admin preview sections:", sectionError.message);
    return null;
  }

  const sectionRows = sections ?? [];
  const sectionIds = sectionRows.map((section) => section.id);
  let lessonRows: PreviewLessonRow[] = [];

  if (sectionIds.length > 0) {
    const { data: lessons, error: lessonError } = await supabase
      .from("lessons")
      .select("section_id, lesson_key, title, duration_seconds, sort_order")
      .in("section_id", sectionIds)
      .neq("status", "archived")
      .order("sort_order", { ascending: true })
      .returns<PreviewLessonRow[]>();

    if (lessonError) {
      console.error("Failed to load admin preview lessons:", lessonError.message);
      return null;
    }
    lessonRows = lessons ?? [];
  }

  const lessonsBySection = new Map<string, CourseLesson[]>();
  for (const lesson of lessonRows) {
    const current = lessonsBySection.get(lesson.section_id) ?? [];
    current.push({
      id: lesson.lesson_key,
      title: lesson.title,
      durationSeconds: lesson.duration_seconds,
      // 관리자 미리보기에서는 작성 중 차시도 선택해 영상 연결 상태를 검수한다.
      availability: "available",
    });
    lessonsBySection.set(lesson.section_id, current);
  }

  const previewSections: CourseSection[] = sectionRows.map((section) => ({
    id: section.section_key,
    title: section.title,
    description: section.description,
    lessons: lessonsBySection.get(section.id) ?? [],
  }));

  return {
    slug: course.slug,
    title: course.title,
    shortTitle: course.short_title,
    description: course.description,
    instructor: course.instructor,
    posterSrc: isLocalPath(course.poster_path) ? course.poster_path : "/assets/profile.jpg",
    sections: previewSections,
  };
}

function isLocalPath(value: string | null): value is string {
  return Boolean(value?.startsWith("/") && !value.startsWith("//"));
}
