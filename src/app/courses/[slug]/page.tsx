import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SaleDetailPage from "@/components/store/SaleDetailPage";
import {
  isMembershipPlanSlug,
  membershipEconomicOutcomeNotice,
  membershipPlanDefinitions,
} from "@/lib/store/membership-plans";
import { loadPublicCourseCatalog } from "@/lib/store/public-course-catalog";
import { loadPublicSaleDetail } from "@/lib/store/public-sale";

type SaleDetailRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: SaleDetailRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const canonicalSlug = isMembershipPlanSlug(slug)
    ? membershipPlanDefinitions[0].slug
    : slug;
  const item = await loadPublicSaleDetail(canonicalSlug);

  if (!item) return { title: "페이지를 찾을 수 없습니다 | 이윰 클래스" };

  return {
    title: `${item.title} | 이윰 클래스`,
    description: item.summary,
  };
}

export default async function CourseDetailRoute({ params }: SaleDetailRouteProps) {
  const { slug } = await params;
  const membershipCourse = isMembershipPlanSlug(slug);
  const canonicalSlug = membershipCourse ? membershipPlanDefinitions[0].slug : slug;
  const [item, courseCatalog] = await Promise.all([
    loadPublicSaleDetail(canonicalSlug),
    membershipCourse ? loadPublicCourseCatalog() : Promise.resolve([]),
  ]);
  if (!item || item.productType === "ebook") notFound();

  const membershipProducts = membershipCourse
    ? courseCatalog
        .filter(
          (course) =>
            course.source === "database" && isMembershipPlanSlug(course.slug)
        )
        .map((course) => ({
          slug: course.slug,
          priceKrw: course.priceKrw,
          soldOut: course.soldOut,
          checkoutHref: course.checkoutHref,
        }))
    : undefined;

  return (
    <SaleDetailPage
      item={item}
      membershipProducts={membershipProducts}
      complianceNotice={
        membershipCourse ? membershipEconomicOutcomeNotice : undefined
      }
    />
  );
}
