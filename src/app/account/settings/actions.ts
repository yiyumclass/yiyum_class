"use server";

import { createClient } from "@/lib/supabase/server";

export type AccountActionResult = {
  ok: boolean;
  message: string;
};

export async function updateAccountProfileAction(
  formData: FormData
): Promise<AccountActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, message: "로그인이 필요합니다." };

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
    console.error("Failed to update account profile", error);
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

  const { error: consentError } = await supabase.rpc("update_my_marketing_consent", {
    marketing_opt_in: input.marketingEnabled === true,
  });
  if (consentError) {
    console.error("Failed to update marketing consent", consentError);
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
    console.error("Failed to update notification preferences", error);
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

  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) {
    console.error("Failed to sign out other devices", error);
    return { ok: false, message: "다른 기기 로그아웃에 실패했습니다." };
  }

  return { ok: true, message: "다른 기기의 로그인 세션을 종료했습니다." };
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
