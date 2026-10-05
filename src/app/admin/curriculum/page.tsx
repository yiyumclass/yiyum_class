import type { Metadata } from "next";
import AdminMarketingCurriculumManager from "@/components/admin/AdminMarketingCurriculumManager";
import { requireAdmin } from "@/lib/admin/auth";
import { loadAdminMarketingCurriculum } from "@/lib/admin/marketing-curriculum";

export const metadata: Metadata = {
  title: "공개 커리큘럼 | 이윰 관리자",
  description: "홈페이지에 공개하는 챕터, 강의와 과제 안내를 관리합니다.",
};

export default async function AdminCurriculumPage() {
  await requireAdmin();
  const result = await loadAdminMarketingCurriculum();

  return <AdminMarketingCurriculumManager initialResult={result} />;
}
