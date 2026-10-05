import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyCourseLessonDescriptions,
  isLessonDescriptionSchemaMissing,
  type LessonDescriptionRow,
} from "@/lib/learning/lesson-description";
import type { Course } from "@/lib/learning/types";

export async function hydrateCourseLessonDescriptions(
  supabase: SupabaseClient,
  course: Course
): Promise<Course> {
  const { data, error } = await supabase.rpc("get_course_lesson_descriptions", {
    target_course_slug: course.slug,
  });

  if (error) {
    if (!isLessonDescriptionSchemaMissing(error.code)) {
      console.error("Failed to load lesson descriptions:", error.message);
    }
    return course;
  }

  return applyCourseLessonDescriptions(course, (data ?? []) as LessonDescriptionRow[]);
}
