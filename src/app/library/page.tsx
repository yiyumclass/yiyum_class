import type { Metadata } from "next";
import ShelfPage from "@/components/store/ShelfPage";
import { loadPublicResourceCatalog } from "@/lib/store/public-sale";

export const metadata: Metadata = {
  title: "무료자료 | 이윰 클래스",
  description:
    "이윰이 나눠주는 무료 자료를 모았습니다. 로그인만 하면 전체를 바로 읽어볼 수 있어요.",
};

export default async function LibraryPage() {
  const catalog = await loadPublicResourceCatalog();
  // 가르는 축은 판매가다. 전자책을 한시적으로 0원에 풀면 그때는 실제로 무료 자료
  // 역할을 하므로 이 목록으로 옮겨오는 것이 맞다.
  const freebies = catalog.filter((item) => item.priceKrw === 0);

  return (
    <ShelfPage
      navKey="library"
      currentPath="/library"
      eyebrow="YIYUM FREE LIBRARY"
      title="무료자료"
      lead="바로 채워 쓸 수 있는 템플릿과 정리 노트를 나눠드려요. 로그인만 하시면 전체를 여기서 읽어보실 수 있어요."
      items={freebies}
      countLabel="FREE"
      emptyTitle="준비 중인 자료가 곧 열립니다."
      emptyBody="먼저 받아보고 싶으시면 카카오톡 채널을 추가해 주세요."
    />
  );
}
