import type { Metadata } from "next";
import { Suspense } from "react";
import AdminLearningProgress from "@/components/admin/AdminLearningProgress";
import { requireAdmin } from "@/lib/admin/auth";
import {
  ADMIN_LEARNING_SORTS,
  ADMIN_LEARNING_STATUSES,
  loadAdminLearningPage,
} from "@/lib/admin/learning-progress";
import {
  readOption,
  readPage,
  readPageSize,
  readParam,
  readUuid,
  resolvePageWindow,
} from "@/lib/admin/list-params";

export const metadata: Metadata = {
  title: "학습 현황 | 이윰 관리자",
  description: "회원과 강의별 학습 진도와 최근 학습 상태를 확인합니다.",
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AdminProgressPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const search = readParam(params.q);
  const status = readOption(params.status, ADMIN_LEARNING_STATUSES, "all");
  const courseId = readUuid(params.course);
  const sort = readOption(params.sort, ADMIN_LEARNING_SORTS, "recent");
  const pageSize = readPageSize(params.size);
  const requestedPage = readPage(params.page);

  // 전체 건수는 조회해 봐야 알 수 있으므로 일단 요청받은 페이지로 읽는다.
  const requestedOffset = (requestedPage - 1) * pageSize;
  const result = await loadAdminLearningPage({
    search,
    status,
    courseId,
    sort,
    limit: pageSize,
    offset: requestedOffset,
  });

  // 필터를 좁혀 페이지 수가 줄었는데 URL에 옛 page가 남아 있으면 빈 표가 나온다.
  // 그 경우에만 마지막 페이지로 당겨 한 번 더 읽는다.
  const { currentPage, offset } = resolvePageWindow(requestedPage, pageSize, result.totalCount);
  const page =
    offset === requestedOffset
      ? result
      : await loadAdminLearningPage({
          search,
          status,
          courseId,
          sort,
          limit: pageSize,
          offset,
        });

  return (
    // 화면이 검색·필터 상태를 URL에서 읽으므로(useSearchParams) 경계를 둔다.
    <Suspense fallback={null}>
      <AdminLearningProgress
        records={page.records}
        totalCount={page.totalCount}
        summary={page.summary}
        courses={page.courses}
        page={currentPage}
        pageSize={pageSize}
        databaseReady={page.databaseReady}
        sourceMessage={page.message}
        referenceTime={new Date().toISOString()}
      />
    </Suspense>
  );
}
