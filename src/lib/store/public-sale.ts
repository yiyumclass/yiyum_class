import "server-only";

import { cache } from "react";
import { consultingCopyBySlug } from "@/lib/store/consulting-copy";
import {
  loadProductPages,
  type ProductPageView,
} from "@/lib/store/product-pages";
import {
  loadPublicDetailItems,
  type PublicDetailItem,
} from "@/lib/store/public-detail-items";
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
  /** 히어로 버튼이 가는 곳. 보낼 데가 없으면 버튼을 그리지 않는다. */
  ctaHref: string | null;
  /** 잠금을 푸는 곳. 무료 자료는 로그인만 하면 된다. */
  unlockHref: string;
  unlockLabel: string;
  /** 상세 소개 문단. 빈 줄로 나눈다. */
  detailParagraphs: string[];
  /** 상세에 반복해 나오는 항목 */
  detailItems: PublicDetailItem[];
  /** 내려받을 자료가 붙어 있는지 */
  hasFile: boolean;
  /** 자료 뷰어가 그릴 페이지. 자료가 아니면 비어 있다. */
  pageView: ProductPageView;
  headerActive: "courses" | "ebook" | "library";
  breadcrumbHref: string;
  breadcrumbLabel: string;
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

/** 무료자료실 목록. 유료 클래스와 섞지 않는다. */
export const loadPublicResourceCatalog = cache(async function loadPublicResourceCatalog(): Promise<
  SaleCard[]
> {
  const resources = await loadPublicProductsByType("ebook");
  return resources.map(mapResourceCard);
});

export const loadPublicSaleDetail = cache(async function loadPublicSaleDetail(
  slug: string
): Promise<SaleDetail | null> {
  const course = await loadPublicCourseBySlug(slug);
  if (course) return mapCourseDetail(course);

  const product = await loadPublicProductBySlug(slug);
  if (!product) return null;

  if (product.productType === "consulting") {
    const detailItems = await loadPublicDetailItems(slug);
    return mapConsultingDetail(product, detailItems);
  }

  const [detailItems, pageView] = await Promise.all([
    loadPublicDetailItems(slug),
    loadProductPages(slug),
  ]);
  return mapResourceDetail(product, detailItems, pageView);
});

const emptyPageView: ProductPageView = {
  pages: [],
  totalCount: 0,
  unlockedCount: 0,
  lockedCount: 0,
};

/** 빈 줄로 나눈 문단. 관리자가 넣은 줄바꿈을 그대로 살린다. */
function splitParagraphs(value: string | null) {
  if (!value) return [];
  return value
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

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
    ctaHref: item.checkoutHref,
    unlockHref: item.checkoutHref,
    unlockLabel: "수강 신청",
    detailParagraphs: [],
    detailItems: [],
    hasFile: false,
    pageView: emptyPageView,
    headerActive: "courses",
    breadcrumbHref: "/courses",
    breadcrumbLabel: "클래스",
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

function mapConsultingDetail(
  product: PublicProduct,
  detailItems: PublicDetailItem[]
): SaleDetail {
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
    ctaHref: `/checkout?product=${encodeURIComponent(product.slug)}`,
    unlockHref: `/checkout?product=${encodeURIComponent(product.slug)}`,
    unlockLabel: "예약하기",
    detailParagraphs: splitParagraphs(product.detailBody),
    detailItems,
    hasFile: product.hasFile,
    pageView: emptyPageView,
    headerActive: "courses",
    breadcrumbHref: "/courses",
    breadcrumbLabel: "클래스",
  };
}

function mapResourceCard(product: PublicProduct): SaleCard {
  return {
    key: product.id,
    productType: "ebook",
    slug: product.slug,
    title: product.title,
    summary: product.summary,
    priceKrw: product.priceKrw,
    listPriceKrw: product.listPriceKrw,
    soldOut: product.soldOut,
    thumbnailSrc: product.thumbnailSrc,
    detailHref: `/library/${product.slug}`,
    visualLabel: product.priceKrw === 0 ? "FREE" : "DIGITAL",
    visualCaption: "이윰",
    eyebrow: "FREE · LIBRARY",
    metaItems: [
      product.priceKrw === 0 ? "무료 자료" : "디지털 자료",
      product.accessLabel,
    ],
  };
}

function mapResourceDetail(
  product: PublicProduct,
  detailItems: PublicDetailItem[],
  pageView: ProductPageView
): SaleDetail {
  const card = mapResourceCard(product);
  const free = product.priceKrw === 0;

  return {
    ...card,
    visualLabel: free ? "YIYUM FREE LIBRARY" : "YIYUM LIBRARY",
    checkoutHref: `/checkout?product=${encodeURIComponent(product.slug)}`,
    accessLabel: product.accessLabel,
    facts: [
      {
        label: "형태",
        value: free ? "이 화면에서 읽는 자료" : "내려받는 디지털 자료",
      },
      { label: "비용", value: free ? "무료" : "유료" },
      {
        label: "분량",
        value:
          pageView.totalCount > 0
            ? `${pageView.totalCount}장`
            : product.hasFile
              ? "신청 후 마이 클래스에서"
              : "자료 준비 중",
      },
      { label: "이용 기간", value: product.accessLabel },
    ],
    course: null,
    // 무료 자료는 내려받는 것이 아니라 이 화면에서 읽는다. "받기"라는 말이
    // 남아 있으면 파일이 오기를 기다리게 된다.
    ctaLabel: free ? "바로 읽어보기" : "구매하기",
    ctaHref: free
      ? pageView.totalCount > 0
        ? "#resource-viewer"
        : null
      : `/checkout?product=${encodeURIComponent(product.slug)}`,
    unlockHref: free
      ? `/login?next=${encodeURIComponent(`/library/${product.slug}`)}`
      : `/checkout?product=${encodeURIComponent(product.slug)}`,
    unlockLabel: free ? "로그인하고 이어보기" : "구매하고 이어보기",
    detailParagraphs: splitParagraphs(product.detailBody),
    detailItems,
    hasFile: product.hasFile,
    pageView,
    headerActive: free ? "library" : "ebook",
    // 상세 주소는 /library 하나로 두고 목록만 나눈다. 주소까지 가르면 값이
    // 바뀔 때마다 링크가 깨진다. 돌아갈 곳은 지금 값에 맞춰 정한다.
    breadcrumbHref: free ? "/library" : "/ebooks",
    breadcrumbLabel: free ? "무료자료" : "전자책",
  };
}

function formatDuration(seconds: number) {
  if (seconds <= 0) return "재생 시간 안내 예정";
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`;
}
