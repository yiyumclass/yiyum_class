export type CourseProduct = {
  courseSlug: string;
  category: string;
  tagline: string;
  price: number;
  accessLabel: string;
  feedbackLabel: string;
  detailHref: string;
  checkoutHref: string;
  topics: string[];
};

/**
 * 판매 DB(products)가 연결되기 전 사용하는 공개 강의 카탈로그 메타데이터.
 * 강의 커리큘럼은 learning/catalog, 가격과 판매 정보는 이 파일에서 분리해 관리한다.
 */
export const courseProducts: CourseProduct[] = [
  {
    courseSlug: "sns-monetization",
    category: "SNS · MONETIZATION",
    tagline: "계정의 방향을 정하고 콘텐츠와 브랜드 협업 준비를 연결하는 방법",
    price: 0,
    accessLabel: "365일 VOD 수강",
    feedbackLabel: "1:1 피드백 포함",
    detailHref: "/#curriculum",
    checkoutHref: "/checkout",
    topics: ["계정 설계", "콘텐츠", "알고리즘", "협찬", "브랜딩"],
  },
];
