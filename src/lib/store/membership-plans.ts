export type MembershipPlanDefinition = {
  slug: string;
  eyebrow: string;
  order: number;
  icon: string;
  title: string;
  description: string;
  benefits: readonly string[];
  recommended: boolean;
  fallbackPriceKrw: number;
};

export const membershipPlanDefinitions = [
  {
    slug: "sns-monetization",
    eyebrow: "VOD",
    order: 1,
    icon: "🎬",
    title: "베이직 클래스",
    description: "필요한 순간마다 다시 보며 내 속도로 적용하는 기본 과정",
    benefits: ["전체 VOD 강의"],
    recommended: false,
    fallbackPriceKrw: 930_000,
  },
  {
    slug: "sns-monetization-feedback",
    eyebrow: "FEEDBACK",
    order: 2,
    icon: "🔥",
    title: "부스터 클래스",
    description: "혼자 멈추지 않도록 과제와 피드백을 함께 받는 과정",
    benefits: ["전체 VOD 강의", "실전 과제", "동기 오픈카톡방", "이윰 1:1 피드백"],
    recommended: true,
    fallbackPriceKrw: 1_200_000,
  },
  {
    slug: "sns-monetization-ultra",
    eyebrow: "ULTRA",
    order: 3,
    icon: "👑",
    title: "프리미엄 클래스",
    description: "피드백에 짧고 밀도 높은 전화 코칭까지 더한 집중 과정",
    benefits: [
      "전체 VOD 강의",
      "실전 과제",
      "동기 오픈카톡방",
      "이윰 1:1 피드백",
      "1:1 전화 코칭 10분 × 6회",
    ],
    recommended: false,
    fallbackPriceKrw: 2_990_000,
  },
] as const satisfies readonly MembershipPlanDefinition[];

export const phonePassDefinition = {
  slug: "yiyum-phone-pass",
  eyebrow: "1:1 PHONE",
  title: "이윰 1:1 전화권",
  description: "이미 수강 중이고, 내 계정에 맞춘 짧은 상담이 필요할 때 이용해요.",
  benefits: ["계정 인사이트 분석", "콘텐츠·알고리즘 점검", "수익화 고민 상담", "10분 × 6회 제공"],
  fallbackPriceKrw: 330_000,
} as const;

export const membershipEconomicOutcomeNotice =
  "본 과정은 SNS 계정 운영과 브랜드 협업 준비 방법을 다루는 교육 콘텐츠입니다. 수강만으로 협찬·광고·원고료 등 특정 경제적 성과를 보장하지 않으며, 결과는 계정 상태·활동 내용·시장 상황에 따라 달라질 수 있습니다.";

export function getMembershipBenefits(productSlug: string): readonly string[] {
  const classPlan = membershipPlanDefinitions.find((plan) => plan.slug === productSlug);
  if (classPlan) return classPlan.benefits;
  if (productSlug === phonePassDefinition.slug) return phonePassDefinition.benefits;
  return [];
}

export function getMembershipAccessLabel(productSlug: string): string | null {
  return productSlug === phonePassDefinition.slug ? "10분 × 6회 이용" : null;
}

export function isMembershipPlanSlug(productSlug: string): boolean {
  return membershipPlanDefinitions.some((plan) => plan.slug === productSlug);
}

/**
 * 같은 VOD를 공유하는 등급을 여러 개 보유해도 마이 클래스에서는
 * 혜택이 가장 많은 현재 등급 하나만 보여준다.
 */
export function getHighestMembershipPlanSlug(
  productSlugs: Iterable<string>
): string | null {
  const ownedSlugs = new Set(productSlugs);

  for (let index = membershipPlanDefinitions.length - 1; index >= 0; index -= 1) {
    const plan = membershipPlanDefinitions[index];
    if (ownedSlugs.has(plan.slug)) return plan.slug;
  }

  return null;
}
