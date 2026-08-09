import type { Metadata } from "next";
import ShelfPage from "@/components/store/ShelfPage";
import { loadPublicResourceCatalog } from "@/lib/store/public-sale";

export const metadata: Metadata = {
  title: "전자책 | 이윰 클래스",
  description:
    "이윰이 만든 전자책을 모았습니다. 한 권으로 정리한 실전 워크북을 만나보세요.",
};

export default async function EbooksPage() {
  const catalog = await loadPublicResourceCatalog();
  // 파는 것과 나눠주는 것을 한 화면에 세우지 않는다. 무료 자료가 곁에 있으면
  // 전자책 값이 싸 보인다.
  const ebooks = catalog.filter((item) => item.priceKrw > 0);

  return (
    <ShelfPage
      navKey="ebook"
      currentPath="/ebooks"
      eyebrow="YIYUM EBOOK"
      title="전자책"
      lead="계정을 키우고 수익으로 연결하는 과정을 한 권에 정리했습니다. 필요한 책을 골라 오늘 바로 적용해 보세요."
      items={ebooks}
      countLabel="BOOK"
      emptyTitle="준비 중인 전자책이 곧 나옵니다."
      emptyBody="먼저 소식을 받아보고 싶으시면 카카오톡 채널을 추가해 주세요."
    />
  );
}
