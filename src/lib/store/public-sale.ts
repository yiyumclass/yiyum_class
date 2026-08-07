import "server-only";

import { cache } from "react";
import { consultingCopyBySlug } from "@/lib/store/consulting-copy";
import type { ProductType } from "@/lib/store/product-type";
import {
  loadPublicCourseBySlug,
  loadPublicCourseCatalog,
  type PublicCourseCatalogItem,
} from "@/lib/store/public-course-catalog";
import {
  loadPublicProductBySlug,
  loadPublicProductsByType,
  type PublicProduct,
} from "@/lib/store/public-products";

/**
 * 판매 화면이 상품 유형을 몰라도 되게 만드는 공통 모양.
 *
 * 가격, 정가, 품절은 유형과 무관하게 같은 자리에서 같은 규칙으로 보여야 한다.
 * 유형마다 화면을 따로 만들면 세일 표시나 품절 처리를 두 번 관리하게 되고,
 * 한쪽만 고치는 순간 화면이 상품마다 다른 말을 한다.
 */
export type SaleFact = { label: string; value: string };

export type SaleCard = {
  key: string;
  productType: ProductType;
  slug: string;
  title: string;
  summary: string;
  priceKrw: number;
  listPriceKrw: number | null;
  soldOut: boolean;
  thumbnailSrc: string | null;
  detailHref: string;
  /** 썸네일 위 배지 */
  visualLabel: string;
  /** 썸네일 아래 이름 */
  visualCaption: string;
  eyebrow: string;
  /** 카드 가운데 한 줄로 붙는 요약 항목 */
  metaItems: string[];
};

export type SaleDetail = SaleCard & {
  checkoutHref: string;
  accessLabel: string;
  /** 히어로의 2×2 스펙 표 */
  facts: SaleFact[];
  /** 강의일 때만 채워진다. 히어로 아래에 커리큘럼을 그린다. */
  course: PublicCourseCatalogItem | null;
  ctaLabel: string;
};

export const loadPublicSaleCatalog = cache(async function loadPublicSaleCatalog(): Promise<
  SaleCard[]
> {
  const [courses, consultings] = await Promise.all([
    loadPublicCourseCatalog(),
    loadPublicProductsByType("consulting"),
  ]);

  return [...courses.map(mapCourseCard), ...consultings.map(mapConsultingCard)];
});

export const loadPublicSaleDetail = cache(async function loadPublicSaleDetail(
  slug: string
): Promise<SaleDetail | null> {
  const course = await loadPublicCourseBySlug(slug);
  if (course) return mapCourseDetail(course);

  const product = await loadPublicProductBySlug(slug);
  if (!product || product.productType !== "consulting") return null;

  return mapConsultingDetail(product);
});

function mapCourseCard(item: PublicCourseCatalogItem): SaleCard {
  const lessons = item.course.sections.flatMap((section) => section.lessons);
  const totalSeconds = lessons.reduce(
    (total, lesson) => total + lesson.durationSeconds,
    0
  );

  return {
    key: item.productId,
    productType: "course",
    slug: item.slug,
    title: item.title,
    summary: item.summary,
    priceKrw: item.priceKrw,
    listPriceKrw: item.listPriceKrw,
    soldOut: item.soldOut,
    thumbnailSrc: item.thumbnailSrc,
    detailHref: item.detailHref,
    visualLabel: "VOD CLASS",
    visualCaption: item.course.instructor || item.title,
    eyebrow: "SNS · MONETIZATION",
    metaItems: item.outlineReady
      ? [`${lessons.length}강`, formatDuration(totalSeconds), item.accessLabel]
      : ["커리큘럼 준비 중", item.accessLabel],
  };
}

function mapCourseDetail(item: PublicCourseCatalogItem): SaleDetail {
  const card = mapCourseCard(item);
  const lessons = item.course.sections.flatMap((section) => section.lessons);
  const totalSeconds = lessons.reduce(
    (total, lesson) => total + lesson.durationSeconds,
    0
  );

  return {
    ...card,
    visualLabel: "YIYUM VOD CLASS",
    checkoutHref: item.checkoutHref,
    accessLabel: item.accessLabel,
    facts: [
      {
        label: "커리큘럼",
        value: item.outlineReady
          ? `${item.course.sections.length}개 챕터 · ${lessons.length}강`
          : "준비 중",
      },
      {
        label: "총 재생 시간",
        value: item.outlineReady ? formatDuration(totalSeconds) : "안내 예정",
      },
      { label: "수강 기간", value: item.accessLabel },
      { label: "수강 방식", value: "마이 클래스에서 VOD 재생" },
    ],
    course: item,
    ctaLabel: "수강 신청",
  };
}

function mapConsultingCard(product: PublicProduct): SaleCard {
  const copy = consultingCopyBySlug[product.slug];

  return {
    key: product.id,
    productType: "consulting",
    slug: product.slug,
    title: product.title,
    summary: product.summary,
    priceKrw: product.priceKrw,
    listPriceKrw: product.listPriceKrw,
    soldOut: product.soldOut,
    thumbnailSrc: product.thumbnailSrc,
    detailHref: `/courses/${product.slug}`,
    visualLabel: "LIVE 1:1",
    visualCaption: "이윰",
    eyebrow: "LIVE · CONSULTING",
    metaItems: copy?.cardMeta ?? ["줌 라이브 1:1", "정원 1명"],
  };
}

function mapConsultingDetail(product: PublicProduct): SaleDetail {
  const card = mapConsultingCard(product);
  const copy = consultingCopyBySlug[product.slug];

  return {
    ...card,
    visualLabel: "YIYUM LIVE 1:1",
    checkoutHref: `/checkout?product=${encodeURIComponent(product.slug)}`,
    accessLabel: product.accessLabel,
    facts: copy?.facts ?? [
      { label: "진행 방식", value: "줌(Zoom) 라이브 1:1" },
      { label: "정원", value: "1명" },
      { label: "예약", value: "결제 후 설문 폼 발송" },
      { label: "이용 기간", value: product.accessLabel },
    ],
    course: null,
    ctaLabel: "예약하기",
  };
}

function formatDuration(seconds: number) {
  if (seconds <= 0) return "재생 시간 안내 예정";
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`;
}
