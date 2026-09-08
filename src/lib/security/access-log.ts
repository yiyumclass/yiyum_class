import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { readSecurityAccessContext } from "./access-log-fields";

export type SecurityAccessProvider = "kakao" | "email";
export type SecurityAccessOutcome = "success" | "failure" | "blocked";

type SecurityAccessEvent = {
  provider: SecurityAccessProvider;
  outcome: SecurityAccessOutcome;
  subject?: string | null;
  failureCode?: string | null;
  headers: Pick<Headers, "get">;
};

/**
 * 로그인 자체는 기록 장애 때문에 막지 않는다. 호출부가 성공·실패 결과를 결정한 뒤
 * 이 함수를 기다려 기록하며, DB 장애는 구조화된 서버 오류로만 남긴다.
 */
export async function recordSecurityAccessEvent(event: SecurityAccessEvent) {
  const context = readSecurityAccessContext(event.headers);

  try {
    const { error } = await getAdminClient().rpc(
      "record_security_access_log_server",
      {
        p_provider: event.provider,
        p_outcome: event.outcome,
        p_subject: event.subject?.trim() || null,
        p_ip_address: context.ipAddress,
        p_user_agent: context.userAgent,
        p_request_id: context.requestId,
        p_failure_code:
          event.outcome === "success" ? null : event.failureCode ?? "unknown",
      }
    );

    if (error) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Failed to record security access event",
          provider: event.provider,
          outcome: event.outcome,
          code: error.code,
        })
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Security access event recorder unavailable",
        provider: event.provider,
        outcome: event.outcome,
        errorType: error instanceof Error ? error.name : "unknown",
      })
    );
    return false;
  }
}
