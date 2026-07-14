import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import CourseClassroom from "@/components/learning/CourseClassroom";
import {
  getCourseBySlug,
  previewCourseProgress,
} from "@/lib/learning/catalog";
import { loadCourseProgress } from "@/lib/learning/progress";
import { createClient } from "@/lib/supabase/server";

type CoursePageProps = {
  params: Promise<{ courseSlug: string }>;
};

export async function generateMetadata({
  params,
}: CoursePageProps): Promise<Metadata> {
  const { courseSlug } = await params;
  const course = getCourseBySlug(courseSlug);

  return {
    title: course ? `${course.title} 강의실 | 이윰 클래스` : "강의실 | 이윰 클래스",
    description: course?.description,
  };
}

export default async function CoursePage({ params }: CoursePageProps) {
  const { courseSlug } = await params;
  const course = getCourseBySlug(courseSlug);

  if (!course) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/learn/${encodeURIComponent(courseSlug)}`);
  }

  // TODO: entitlements에서 이 사용자의 유효한 강의 이용권을 확인한 뒤 렌더링한다.
  const progressResult = await loadCourseProgress(supabase, course);
  const progress = progressResult.available
    ? progressResult.progress
    : previewCourseProgress[courseSlug];
  const metadata = user.user_metadata ?? {};
  const rawDisplayName = metadata.nickname ?? metadata.name ?? metadata.full_name;
  const displayName =
    typeof rawDisplayName === "string" && rawDisplayName.trim()
      ? rawDisplayName.trim()
      : "회원";

  return (
    <CourseClassroom
      course={course}
      initialProgress={progress}
      displayName={displayName}
      progressPersistenceEnabled={progressResult.available}
    />
  );
}
