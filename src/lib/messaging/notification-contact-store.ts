import "server-only";

import { lookupKakaoPhone } from "@/lib/auth/kakao-phone-request";
import { getAdminClient } from "@/lib/supabase/admin";
import { NotificationContactError, resolveNotificationContact, type NotificationContactUser, type VerifiedNotificationContact } from "./notification-contact";

export async function resolveUserNotificationContact(
  user: NotificationContactUser,
  options: { accessToken?: string | null; refresh?: boolean } = {}
) {
  const admin = getAdminClient();
  const { data: withdrawal, error: withdrawalError } = await admin.from("account_withdrawals").select("user_id").eq("user_id", user.id).maybeSingle();
  if (withdrawalError) throw new NotificationContactError("CONTACT_STORAGE_FAILED");
  if (withdrawal) throw new NotificationContactError("ACCOUNT_INACTIVE");
  return resolveNotificationContact(user, {
    async load(userId) {
      const { data, error } = await admin.from("user_notification_contacts").select("kakao_user_id,phone,verified_at").eq("user_id", userId).maybeSingle<VerifiedNotificationContact>();
      if (error) throw new NotificationContactError("CONTACT_STORAGE_FAILED");
      return data;
    },
    async save(userId, contact) {
      const { error } = await admin.from("user_notification_contacts").upsert({ user_id: userId, ...contact });
      if (error) throw new NotificationContactError("CONTACT_STORAGE_FAILED");
    },
    async remove(userId) {
      const { error } = await admin.from("user_notification_contacts").delete().eq("user_id", userId);
      if (error) throw new NotificationContactError("CONTACT_STORAGE_FAILED");
    },
    lookup: kakaoUserId => lookupKakaoPhone({ kakaoUserId, accessToken: options.accessToken, adminKey: process.env.KAKAO_ADMIN_KEY }),
  }, options);
}
