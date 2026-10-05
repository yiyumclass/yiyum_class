import {
  SNS_MARKETING_CURRICULUM_KEY,
  type MarketingCurriculumLoadResult,
} from "./marketing-curriculum-types.ts";
import { validateMarketingCurriculum } from "./marketing-curriculum-validation.ts";

export type MarketingCurriculumRow = {
  curriculum_key: string;
  chapters: unknown;
  version: number;
  updated_at: string;
};

export function resolveMarketingCurriculumLoad(
  row: MarketingCurriculumRow | null,
  error: { code?: string } | null,
  seed: unknown
): MarketingCurriculumLoadResult {
  const schemaMissing = error && ["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "");
  const validation = row && !error ? validateMarketingCurriculum(row.chapters) : null;
  if (row && !error && row.curriculum_key === SNS_MARKETING_CURRICULUM_KEY && Number.isInteger(row.version) && row.version > 0 && validation?.ok) {
    return {
      curriculum: {
        key: row.curriculum_key,
        chapters: validation.chapters,
        version: row.version,
        source: "database",
        updatedAt: row.updated_at,
      },
      editable: true,
      message: "홈과 판매 상세에 같은 공개 커리큘럼이 표시됩니다.",
    };
  }

  const initialMissing = Boolean(schemaMissing) || (!error && !row);
  const initial = initialMissing ? validateMarketingCurriculum(seed) : null;
  return {
    curriculum: {
      key: SNS_MARKETING_CURRICULUM_KEY,
      chapters: initial?.ok ? initial.chapters : [],
      version: null,
      source: "seed",
      updatedAt: null,
    },
    editable: false,
    message: schemaMissing
      ? "공개 커리큘럼 마이그레이션이 적용되지 않았습니다. 초기 커리큘럼만 표시되며 저장할 수 없습니다."
      : initialMissing
        ? "초기 커리큘럼만 표시 중입니다. 데이터 seed 마이그레이션을 적용한 뒤 편집할 수 있습니다."
        : "공개 커리큘럼을 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.",
  };
}
