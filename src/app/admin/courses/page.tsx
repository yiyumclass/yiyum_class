import type { Metadata } from "next";
import { Suspense } from "react";
import AdminCourseManager from "@/components/admin/AdminCourseManager";
import { requireAdmin } from "@/lib/admin/auth";
import { loadAdminCourses } from "@/lib/admin/courses";

export const metadata: Metadata = {
  title: "강의 관리 | 이윰 관리자",
  description: "VOD 강의의 챕터, 차시와 영상 연결 상태를 관리합니다.",
};

export default async function AdminCoursesPage() {
  await requireAdmin();
  const result = await loadAdminCourses();

  return (
    // 선택한 강의를 URL에서 읽으므로 useSearchParams 경계가 필요하다.
    <Suspense>
      <AdminCourseManager
        courses={result.courses}
        availableProducts={result.availableProducts}
        databaseReady={result.databaseReady}
        videoStorageReady={result.videoStorageReady}
        sourceMessage={result.message}
      />
    </Suspense>
  );
}
