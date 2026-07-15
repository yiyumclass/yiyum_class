import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import CourseClassroom from "@/components/learning/CourseClassroom";
import AdminCoursePreviewEmpty from "@/components/admin/AdminCoursePreviewEmpty";
import { hasActiveAdminAccess } from "@/lib/admin/access";
import { loadAdminCoursePreview } from "@/lib/admin/course-preview";
import {
  createEmptyCourseProgress,
  loadCourseProgress,
} from "@/lib/learning/progress";
import { hydrateCourseVideos } from "@/lib/learning/video";
import { hasActiveProductEntitlement } from "@/lib/store/entitlements";
import { loadPublicCourseBySlug } from "@/lib/store/public-course-catalog";
import { createClient } from "@/lib/supabase/server";

type CoursePageProps = {
  params: Promise<{ courseSlug: string }>;
  searchParams: Promise<{ adminPreview?: string | string[] }>;
};

export async function generateMetadata({
  params,
}: CoursePageProps): Promise<Metadata> {
  const { courseSlug } = await params;
  const catalogItem = await loadPublicCourseBySlug(courseSlug);
  const course = catalogItem?.classroomCourse ?? catalogItem?.course;

  return {
    title: course ? `${course.title} 강의실 | 이윰 클래스` : "강의실 | 이윰 클래스",
    description: course?.description,
  };
}

export default async function CoursePage({ params, searchParams }: CoursePageProps) {
  const { courseSlug } = await params;
  const { adminPreview } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/learn/${encodeURIComponent(courseSlug)}`);
  }

  const isAdmin = await hasActiveAdminAccess(supabase, user.id);
  if (adminPreview === "1" && isAdmin) {
    const previewCourse = await loadAdminCoursePreview(supabase, courseSlug);
    if (!previewCourse) notFound();

    const previewLessonCount = previewCourse.sections.reduce(
      (total, section) => total + section.lessons.length,
      0
    );
    if (previewLessonCount === 0) {
      return <AdminCoursePreviewEmpty title={previewCourse.title} />;
    }

    const hydratedPreview = await hydrateCourseVideos(supabase, previewCourse);
    return (
      <CourseClassroom
        course={hydratedPreview}
        initialProgress={createEmptyCourseProgress(hydratedPreview)}
        displayName="관리자"
        progressPersistenceEnabled={false}
        isAdminPreview
      />
    );
  }

  const catalogItem = await loadPublicCourseBySlug(courseSlug);
  if (!catalogItem?.contentReady || !catalogItem.classroomCourse) notFound();

  const hasEntitlement = await hasActiveProductEntitlement(supabase, courseSlug);
  if (!isAdmin && !hasEntitlement) {
    redirect(`/checkout?product=${encodeURIComponent(courseSlug)}`);
  }

  // 보관 콘텐츠는 제외하고 작성 중 차시는 강의실 목차에서 잠근다.
  const course = await hydrateCourseVideos(supabase, catalogItem.classroomCourse);
  const progressResult = await loadCourseProgress(supabase, course);
  const progress = progressResult.available
    ? progressResult.progress
    : createEmptyCourseProgress(course);
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
