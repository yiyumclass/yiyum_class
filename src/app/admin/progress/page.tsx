import type { Metadata } from "next";
import { Suspense } from "react";
import AdminLearningProgress from "@/components/admin/AdminLearningProgress";
import { requireAdmin } from "@/lib/admin/auth";
import { loadAdminLearningProgress } from "@/lib/admin/learning-progress";

export const metadata: Metadata = {
  title: "학습 현황 | 이윰 관리자",
  description: "회원과 강의별 학습 진도와 최근 학습 상태를 확인합니다.",
};

export default async function AdminProgressPage() {
  await requireAdmin();
  const result = await loadAdminLearningProgress();

  return (
    // 화면이 검색·필터 상태를 URL에서 읽으므로(useSearchParams) 경계를 둔다.
    <Suspense fallback={null}>
      <AdminLearningProgress
        records={result.records}
        databaseReady={result.databaseReady}
        sourceMessage={result.message}
        referenceTime={new Date().toISOString()}
      />
    </Suspense>
  );
}
