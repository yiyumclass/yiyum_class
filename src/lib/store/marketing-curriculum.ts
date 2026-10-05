import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/public";
import { snsMarketingCurriculumSeed } from "./marketing-curriculum-seed";
import { resolveMarketingCurriculumLoad, type MarketingCurriculumRow } from "./marketing-curriculum-data";
import { SNS_MARKETING_CURRICULUM_KEY } from "./marketing-curriculum-types";

export async function loadMarketingCurriculumResult(supabase: SupabaseClient) {
  try {
    const { data, error } = await supabase
      .from("marketing_curricula")
      .select("curriculum_key, chapters, version, updated_at")
      .eq("curriculum_key", SNS_MARKETING_CURRICULUM_KEY)
      .maybeSingle<MarketingCurriculumRow>();
    const result = resolveMarketingCurriculumLoad(data, error, snsMarketingCurriculumSeed);
    if (!result.editable && result.curriculum.chapters.length === 0) {
      console.error("Failed to load marketing curriculum:", error?.code ?? "invalid curriculum");
    }
    return result;
  } catch {
    console.error("Failed to load marketing curriculum: request failed");
    return resolveMarketingCurriculumLoad(null, { code: "request_failed" }, snsMarketingCurriculumSeed);
  }
}

export const loadPublicMarketingCurriculum = cache(async function loadPublicMarketingCurriculum() {
  const result = await loadMarketingCurriculumResult(createPublicClient());
  return result.curriculum;
});
