import "server-only";

import { requireOwnerAdmin } from "@/lib/admin/auth";
import { getAdminClient } from "@/lib/supabase/admin";

export const PRIVACY_PAGE_SIZE = 25;

export type AccessLog = {
  id: string;
  provider: "kakao" | "email";
  outcome: "success" | "failure" | "blocked";
  ip_address: string | null;
  failure_code: string | null;
  occurred_at: string;
  retain_until: string;
};

export type Withdrawal = {
  user_id: string;
  provider: string;
  status: "processing" | "completed";
  provider_unlinked_at: string | null;
  data_purged_at: string | null;
  created_at: string;
  completed_at: string | null;
};

/** 서비스 권한으로 조회하기 전에 매 요청 최고관리자 권한을 검증한다. */
export async function loadPrivacyOperations(logPage: number, withdrawalPage: number) {
  await requireOwnerAdmin();
  const admin = getAdminClient();
  const range = (page: number): [number, number] => {
    const start = (Math.min(10000, Math.max(1, Math.floor(page) || 1)) - 1) * PRIVACY_PAGE_SIZE;
    return [start, start + PRIVACY_PAGE_SIZE - 1];
  };
  const [logs, withdrawals] = await Promise.all([
    admin.from("security_access_logs")
      .select("id,provider,outcome,ip_address,failure_code,occurred_at,retain_until", { count: "exact" })
      .gt("retain_until", new Date().toISOString())
      .order("occurred_at", { ascending: false }).order("id", { ascending: false })
      .range(...range(logPage)),
    admin.from("account_withdrawals")
      .select("user_id,provider,status,provider_unlinked_at,data_purged_at,created_at,completed_at", { count: "exact" })
      .order("created_at", { ascending: false }).order("user_id", { ascending: false })
      .range(...range(withdrawalPage)),
  ]);
  if (logs.error) console.error("Failed to load security access logs:", logs.error.code);
  if (withdrawals.error) console.error("Failed to load withdrawal status:", withdrawals.error.code);
  return {
    logs: (logs.data ?? []) as AccessLog[],
    logCount: logs.count ?? 0,
    logsReady: !logs.error,
    withdrawals: (withdrawals.data ?? []) as Withdrawal[],
    withdrawalCount: withdrawals.count ?? 0,
    withdrawalsReady: !withdrawals.error,
  };
}
