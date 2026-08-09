import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SaleDetailPage from "@/components/store/SaleDetailPage";
import { loadPublicSaleDetail } from "@/lib/store/public-sale";

type LibraryDetailRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: LibraryDetailRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const item = await loadPublicSaleDetail(slug);

  if (!item) return { title: "페이지를 찾을 수 없습니다 | 이윰 클래스" };

  return {
    title: `${item.title} | 이윰 자료실`,
    description: item.summary,
  };
}

/**
 * 자료 상세. 클래스 상세와 같은 화면을 쓰되 주소만 나눈다.
 * 무료 자료가 유료 클래스 사이에 섞이면 클래스 가격이 싸 보인다.
 */
export default async function LibraryDetailRoute({ params }: LibraryDetailRouteProps) {
  const { slug } = await params;
  const item = await loadPublicSaleDetail(slug);
  if (!item || item.productType !== "ebook") notFound();

  return <SaleDetailPage item={item} />;
}
