"use server";

import type { User } from "@supabase/supabase-js";
import {
  hasRecentAuthentication,
  isValidWithdrawalConfirmation,
  readKakaoUserId,
} from "@/lib/auth/account-withdrawal";
import { unlinkKakaoAccount } from "@/lib/auth/kakao-unlink";
import { hasActiveAccount } from "@/lib/supabase/account-status";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type AccountActionResult = {
  ok: boolean;
  message: string;
};

type WithdrawalStateRow = {
  provider: "kakao" | "email";
  status: "processing" | "completed";
  provider_unlinked: boolean;
  data_purged: boolean;
  started_now: boolean;
};

export async function updateAccountProfileAction(
  formData: FormData
): Promise<AccountActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, message: "로그인이 필요합니다." };
  if (!(await hasActiveAccount(supabase))) {
    return { ok: false, message: "이미 탈퇴 처리 중인 계정입니다." };
  }

  const name = readText(formData, "name", 40);
  const nickname = readText(formData, "nickname", 40);
  const phone = readPhone(formData.get("phone"));
  if (!name || !nickname) {
    return { ok: false, message: "이름과 닉네임을 입력해 주세요." };
  }
  if (phone === null) {
    return { ok: false, message: "휴대전화 번호 형식을 확인해 주세요." };
  }

  const { error } = await supabase.auth.updateUser({
    data: { name, nickname, phone },
  });
  if (error) {
    console.error("Failed to update account profile:", error.code ?? error.name);
    return { ok: false, message: "프로필을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  return { ok: true, message: "프로필을 저장했습니다." };
}

export async function updateNotificationPreferencesAction(input: {
  contentUpdatesEnabled: boolean;
  marketingEnabled: boolean;
}): Promise<AccountActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, message: "로그인이 필요합니다." };
  if (!(await hasActiveAccount(supabase))) {
    return { ok: false, message: "이미 탈퇴 처리 중인 계정입니다." };
  }

  const { error: consentError } = await supabase.rpc("update_my_marketing_consent", {
    marketing_opt_in: input.marketingEnabled === true,
  });
  if (consentError) {
    console.error("Failed to update marketing consent:", consentError.code);
    return { ok: false, message: "알림 설정을 저장하지 못했습니다." };
  }

  const { error } = await supabase.auth.updateUser({
    data: {
      content_updates_opt_in: input.contentUpdatesEnabled === true,
      marketing_opt_in: input.marketingEnabled === true,
      marketing_preference_updated_at: new Date().toISOString(),
    },
  });
  if (error) {
    console.error(
      "Failed to update notification preferences:",
      error.code ?? error.name
    );
    return { ok: false, message: "알림 설정을 저장하지 못했습니다." };
  }

  return { ok: true, message: "알림 설정을 저장했습니다." };
}

export async function signOutOtherDevicesAction(): Promise<AccountActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, message: "로그인이 필요합니다." };
  if (!(await hasActiveAccount(supabase))) {
    return { ok: false, message: "이미 탈퇴 처리 중인 계정입니다." };
  }

  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) {
    console.error("Failed to sign out other devices:", error.code ?? error.name);
    return { ok: false, message: "다른 기기 로그아웃에 실패했습니다." };
  }

  return { ok: true, message: "다른 기기의 로그인 세션을 종료했습니다." };
}

export async function withdrawAccountAction(
  confirmation: string
): Promise<AccountActionResult> {
  if (!isValidWithdrawalConfirmation(confirmation)) {
    return { ok: false, message: "확인 문구를 정확히 입력해 주세요." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, message: "로그인이 필요합니다." };

  const provider = hasKakaoIdentity(user) ? "kakao" : "email";
  const admin = getAdminClient();
  const { data: startedData, error: startError } = await admin.rpc(
    "begin_account_withdrawal",
    {
      target_user_id: user.id,
      target_provider: provider,
    }
  );

  if (startError) return translateWithdrawalDatabaseError(startError);

  const state = readWithdrawalState(startedData);
  if (!state) {
    console.error("Account withdrawal returned an invalid start state.");
    return withdrawalSystemError();
  }
  if (state.started_now && !hasRecentAuthentication(user.last_sign_in_at)) {
    await cancelNewWithdrawal(admin, user.id, true);
    return {
      ok: false,
      message: "보안을 위해 로그아웃 후 다시 로그인한 다음 탈퇴해 주세요.",
    };
  }

  if (state.provider === "kakao" && !state.provider_unlinked) {
    const kakaoUserId = readKakaoUserId(user.identities);
    if (!kakaoUserId) {
      await cancelNewWithdrawal(admin, user.id, state.started_now);
      return {
        ok: false,
        message: "카카오 연결 정보를 확인하지 못했습니다. 다시 로그인한 후 시도해 주세요.",
      };
    }

    const unlinkResult = await unlinkKakaoAccount(kakaoUserId);
    // 네트워크 응답을 잃은 뒤 재시도한 경우 -101은 이미 연결이 끊긴 상태로 본다.
    const alreadyUnlinkedAfterRetry =
      !unlinkResult.ok &&
      !state.started_now &&
      unlinkResult.reason === "api" &&
      unlinkResult.code === -101;

    if (!unlinkResult.ok && !alreadyUnlinkedAfterRetry) {
      if (unlinkResult.reason !== "network") {
        await cancelNewWithdrawal(admin, user.id, state.started_now);
      }
      return translateKakaoUnlinkError(unlinkResult.reason);
    }

    const { data: marked, error: markError } = await admin.rpc(
      "mark_account_withdrawal_provider_unlinked",
      { target_user_id: user.id }
    );
    if (markError || marked !== true) {
      console.error(
        "Failed to persist Kakao unlink completion:",
        markError?.code ?? "invalid-result"
      );
      return withdrawalSystemError();
    }
  }

  if (!state.data_purged) {
    const { data: finalized, error: finalizeError } = await admin.rpc(
      "finalize_account_withdrawal",
      { target_user_id: user.id }
    );
    if (finalizeError) return translateWithdrawalDatabaseError(finalizeError);
    if (finalized !== true) return withdrawalSystemError();
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id, true);
  if (deleteError) {
    console.error(
      "Failed to soft-delete withdrawn Auth account:",
      deleteError.code ?? deleteError.name
    );
    return withdrawalSystemError();
  }

  const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
  if (signOutError) {
    console.error(
      "Failed to clear withdrawn account session:",
      signOutError.code ?? signOutError.name
    );
  }

  const { data: completed, error: completeError } = await admin.rpc(
    "complete_account_withdrawal",
    { target_user_id: user.id }
  );
  if (completeError || completed !== true) {
    console.error(
      "Failed to mark account withdrawal complete:",
      completeError?.code ?? "invalid-result"
    );
    // Auth 계정과 회원 데이터는 이미 삭제됐다. 완료 표시는 운영 재처리가 가능하므로
    // 사용자에게 실패로 보이게 하거나 재가입을 유도하지 않는다.
  }

  return { ok: true, message: "회원 탈퇴가 완료되었습니다." };
}

function readText(formData: FormData, key: string, maxLength: number) {
  const value = formData.get(key);
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function readPhone(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/[\s-]/g, "").trim();
  if (!normalized) return "";
  return /^01[016789]\d{7,8}$/.test(normalized) ? normalized : null;
}

function hasKakaoIdentity(user: User) {
  return (user.identities ?? []).some((identity) => identity.provider === "kakao");
}

function readWithdrawalState(data: unknown): WithdrawalStateRow | null {
  const row = Array.isArray(data) ? data[0] : null;
  if (!row || typeof row !== "object") return null;

  const value = row as Record<string, unknown>;
  if (
    (value.provider !== "kakao" && value.provider !== "email") ||
    (value.status !== "processing" && value.status !== "completed") ||
    typeof value.provider_unlinked !== "boolean" ||
    typeof value.data_purged !== "boolean" ||
    typeof value.started_now !== "boolean"
  ) {
    return null;
  }

  return value as WithdrawalStateRow;
}

async function cancelNewWithdrawal(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
  startedNow: boolean
) {
  if (!startedNow) return;

  const { error } = await admin.rpc("cancel_account_withdrawal", {
    target_user_id: userId,
  });
  if (error) {
    console.error("Failed to cancel account withdrawal start:", error.code);
  }
}

function translateKakaoUnlinkError(
  reason: "configuration" | "network" | "api" | "invalid-response"
): AccountActionResult {
  if (reason === "configuration") {
    return {
      ok: false,
      message: "카카오 탈퇴 연동 설정을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
  if (reason === "network") {
    return {
      ok: false,
      message: "카카오 연결 해제 응답이 지연되고 있습니다. 이 화면에서 잠시 후 다시 시도해 주세요.",
    };
  }
  return {
    ok: false,
    message: "카카오 계정 연결을 해제하지 못했습니다. 다시 로그인한 후 시도해 주세요.",
  };
}

function translateWithdrawalDatabaseError(error: {
  code?: string;
  message?: string;
}): AccountActionResult {
  if (error.message === "active_admin_account") {
    return {
      ok: false,
      message: "관리자 계정은 운영 권한을 정리한 후 탈퇴할 수 있습니다.",
    };
  }
  if (error.message === "payment_in_progress") {
    return {
      ok: false,
      message: "진행 중인 결제가 있습니다. 결제 완료 또는 취소 후 다시 시도해 주세요.",
    };
  }
  if (error.message === "refund_in_progress") {
    return {
      ok: false,
      message: "처리 중인 환불이 있습니다. 환불 완료 후 다시 시도해 주세요.",
    };
  }

  const setupRequired =
    error.code === "42883" ||
    error.code === "PGRST202" ||
    error.code === "PGRST205";
  if (!setupRequired) {
    console.error("Account withdrawal database step failed:", error.code);
  }
  return setupRequired
    ? {
        ok: false,
        message: "회원 탈퇴 데이터베이스 설정을 적용하고 있습니다. 잠시 후 다시 시도해 주세요.",
      }
    : withdrawalSystemError();
}

function withdrawalSystemError(): AccountActionResult {
  return {
    ok: false,
    message: "회원 탈퇴를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  };
}
