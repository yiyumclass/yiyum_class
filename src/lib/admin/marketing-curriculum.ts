import "server-only";

import { requireAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import { loadMarketingCurriculumResult } from "@/lib/store/marketing-curriculum";

export async function loadAdminMarketingCurriculum() {
  await requireAdmin();
  return loadMarketingCurriculumResult(await createClient());
}
