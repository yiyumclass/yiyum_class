import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Course } from "@/lib/learning/types";

export type CourseVideoManifestRow = {
  lesson_key: string;
  video_path: string;
  video_provider: "local" | "supabase";
  duration_seconds: number;
};

export async function loadCourseVideoManifest(
  supabase: SupabaseClient,
  courseSlug: string
) {
  const { data, error } = await supabase.rpc("get_course_video_manifest", {
    target_course_slug: courseSlug,
  });

  if (error) {
    const unavailable =
      error.code === "42883" || error.code === "PGRST202" || error.code === "PGRST205";
    if (!unavailable) {
      console.error("Failed to load course video manifest:", error.message);
    }
    return { available: false as const, videos: [] as CourseVideoManifestRow[] };
  }

  return {
    available: true as const,
    videos: (data ?? []) as unknown as CourseVideoManifestRow[],
  };
}

export async function hydrateCourseVideos(
  supabase: SupabaseClient,
  course: Course
): Promise<Course> {
  const manifest = await loadCourseVideoManifest(supabase, course.slug);
  if (!manifest.available || manifest.videos.length === 0) return course;

  const videoByLessonKey = new Map(
    manifest.videos.map((video) => [video.lesson_key, video])
  );

  return {
    ...course,
    sections: course.sections.map((section) => ({
      ...section,
      lessons: section.lessons.map((lesson) => {
        const video = videoByLessonKey.get(lesson.id);
        if (!video) return lesson;

        return {
          ...lesson,
          durationSeconds: video.duration_seconds || lesson.durationSeconds,
          videoSrc:
            video.video_provider === "local"
              ? video.video_path
              : `/api/learning/video/${encodeURIComponent(course.slug)}/${encodeURIComponent(lesson.id)}`,
        };
      }),
    })),
  };
}
