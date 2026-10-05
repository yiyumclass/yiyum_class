"use server";

import { requireOwnerAdmin } from "@/lib/admin/auth";
import { adminNotificationError, confirmAdminNotification, loadNotificationHistory, loadNotificationPanel, previewAdminNotification, reconcileAdminNotificationDeliveries } from "@/lib/messaging/admin-notifications";
import type { NotificationActionResult, NotificationHistory, NotificationPanel, NotificationPreview, NotificationPreviewInput } from "@/lib/messaging/admin-notification-types";

export async function loadMemberNotificationAction(memberId: string): Promise<NotificationActionResult<NotificationPanel>> {
  await requireOwnerAdmin();
  try { return { ok: true, data: await loadNotificationPanel(memberId) }; }
  catch (error) { return { ok: false, message: adminNotificationError(error) }; }
}

export async function previewMemberNotificationAction(input: NotificationPreviewInput): Promise<NotificationActionResult<NotificationPreview>> {
  const admin = await requireOwnerAdmin();
  try { return { ok: true, data: await previewAdminNotification(admin.userId, input) }; }
  catch (error) { return { ok: false, message: adminNotificationError(error) }; }
}

export async function sendMemberNotificationAction(draftId: string): Promise<NotificationActionResult<string>> {
  const admin = await requireOwnerAdmin();
  try { return { ok: true, data: await confirmAdminNotification(admin.userId, draftId) }; }
  catch (error) { return { ok: false, message: adminNotificationError(error) }; }
}

export async function refreshMemberNotificationHistoryAction(memberId: string): Promise<NotificationActionResult<NotificationHistory[]>> {
  await requireOwnerAdmin();
  try {
    await reconcileAdminNotificationDeliveries(memberId);
    return { ok: true, data: await loadNotificationHistory(memberId) };
  } catch (error) { return { ok: false, message: adminNotificationError(error) }; }
}
