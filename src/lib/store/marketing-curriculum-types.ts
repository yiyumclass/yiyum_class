import { isMembershipPlanSlug } from "./membership-plans.ts";

export const SNS_MARKETING_CURRICULUM_KEY = "sns-monetization";
export const MAX_MARKETING_CHAPTERS = 30;
export const MAX_MARKETING_ITEMS_PER_CHAPTER = 150;
export const MAX_MARKETING_ITEMS = 300;

export type MarketingCurriculumItem = {
  key: string;
  title: string;
  lessonNumber: number | null;
  kind: "lesson" | "assignment";
};

export type MarketingCurriculumChapter = {
  key: string;
  title: string;
  items: MarketingCurriculumItem[];
};

export type MarketingCurriculum = {
  key: string;
  chapters: MarketingCurriculumChapter[];
  version: number | null;
  source: "database" | "seed";
  updatedAt: string | null;
};

export type MarketingCurriculumLoadResult = {
  curriculum: MarketingCurriculum;
  editable: boolean;
  message: string;
};

export function countMarketingLessons(chapters: readonly MarketingCurriculumChapter[]) {
  return chapters.reduce(
    (total, chapter) => total + chapter.items.filter((item) => item.lessonNumber !== null).length,
    0
  );
}

export function marketingCurriculumKeyForProduct(slug: string): string | null {
  return isMembershipPlanSlug(slug) ? SNS_MARKETING_CURRICULUM_KEY : null;
}
