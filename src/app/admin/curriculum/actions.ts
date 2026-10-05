"use server";

import { revalidatePath } from "next/cache";
import { getAdminAccess } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import { SNS_MARKETING_CURRICULUM_KEY, type MarketingCurriculumChapter } from "@/lib/store/marketing-curriculum-types";
import { validateMarketingCurriculum } from "@/lib/store/marketing-curriculum-validation";

export type MarketingCurriculumSaveResult =
  | { ok: true; version: number; message: string }
  | { ok: false; code: "invalid" | "stale" | "unavailable" | "forbidden" | "error"; message: string };

export async function saveMarketingCurriculumAction(input: {
  key: string;
  expectedVersion: number;
  chapters: MarketingCurriculumChapter[];
}): Promise<MarketingCurriculumSaveResult> {
  const access = await getAdminAccess();
  if (access.status !== "granted") {
    return { ok: false, code: "forbidden", message: "관리자 권한을 확인해 주세요." };
  }
  if (!input || input.key !== SNS_MARKETING_CURRICULUM_KEY || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    return { ok: false, code: "invalid", message: "저장할 커리큘럼과 버전을 확인해 주세요." };
  }
  const validation = validateMarketingCurriculum(input.chapters);
  if (!validation.ok) return { ok: false, code: "invalid", message: validation.message };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_marketing_curriculum", {
    target_key: input.key,
    expected_version: input.expectedVersion,
    next_chapters: validation.chapters,
  });
  if (error) {
    if (error.code === "40001") {
      return { ok: false, code: "stale", message: "다른 관리자가 먼저 변경했습니다. 작성한 내용은 유지됩니다. 최신 내용을 다시 불러온 뒤 저장해 주세요." };
    }
    if (["42P01", "42883", "PGRST202", "PGRST205", "P0002"].includes(error.code)) {
      return { ok: false, code: "unavailable", message: "공개 커리큘럼 스키마와 seed 마이그레이션을 적용한 뒤 저장할 수 있습니다." };
    }
    if (error.code === "42501") return { ok: false, code: "forbidden", message: "관리자 권한을 확인해 주세요." };
    if (error.code === "22023") return { ok: false, code: "invalid", message: "입력한 챕터와 항목 형식을 확인해 주세요." };
    console.error("Failed to save marketing curriculum:", error.code);
    return { ok: false, code: "error", message: "커리큘럼을 저장하지 못했습니다. 다시 시도해 주세요." };
  }
  if (typeof data !== "number" || !Number.isInteger(data) || data !== input.expectedVersion + 1) {
    return { ok: false, code: "error", message: "저장 결과를 확인하지 못했습니다. 최신 내용을 다시 불러와 확인해 주세요." };
  }

  revalidatePath("/");
  revalidatePath("/courses");
  revalidatePath("/courses/[slug]", "page");
  revalidatePath("/admin/curriculum");
  return { ok: true, version: data, message: "공개 커리큘럼을 저장했습니다." };
}
