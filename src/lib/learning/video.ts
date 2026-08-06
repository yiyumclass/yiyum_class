import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Course } from "@/lib/learning/types";

export type CourseVideoManifestRow = {
  lesson_key: string;
  // Mux 로 옮긴 차시는 Storage 경로가 없다.
  video_path: string | null;
  video_provider: "local" | "supabase" | "mux";
  mux_playback_id: string | null;
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
          videoSrc: resolveLessonVideoSrc(course.slug, lesson.id),
        };
      }),
    })),
  };
}

function resolveLessonVideoSrc(courseSlug: string, lessonKey: string) {
  // 영상은 전부 Mux 로 전달한다. 이 라우트가 수강권을 확인하고 서명 토큰을 내준다.
  return `/api/learning/video/${encodeURIComponent(courseSlug)}/${encodeURIComponent(lessonKey)}`;
}
