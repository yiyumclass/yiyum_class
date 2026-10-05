import type { AdminKakaoTemplate } from "./admin-notification-template";

export type NotificationHistory = {
  id: string;
  templateName: string;
  status: string;
  createdAt: string;
  deliveredAt: string | null;
  source: "admin" | "payment";
};

export type NotificationEntitlement = {
  id: string;
  productId: string;
  title: string;
  slug: string;
  source: string;
};

export type NotificationPanel = {
  name: string;
  enabled: boolean;
  templates: (AdminKakaoTemplate & { paymentProductSlug: string | null })[];
  unsupported: number;
  entitlements: NotificationEntitlement[];
  history: NotificationHistory[];
};

export type NotificationPreview = {
  id: string;
  name: string;
  maskedPhone: string;
  templateName: string;
  content: string;
  extra: string;
  title: string;
  subtitle: string;
  buttons: { name: string; mobile: string; desktop: string }[];
  expiresAt: string;
};

export type NotificationPreviewInput = {
  memberId: string;
  templateId: string;
  entitlementId: string | null;
  variables: Record<string, string>;
};

export type NotificationActionResult<Value> = { ok: true; data: Value } | { ok: false; message: string };

export const notificationStatusLabels: Record<string, string> = {
  pending: "발송 대기", preparing: "발송 준비", sending: "접수 결과 확인 중",
  accepted: "접수 완료 · 도착 확인 중", delivered: "전달 완료", failed: "접수 실패",
  rejected: "접수 거절 · 확인 필요", unknown: "결과 불명 · 재발송 금지",
  delivery_failed: "전달 실패 · 확인 필요", review: "수동 확인 필요", skipped: "발송 제외",
  waiting_contact: "전화번호 동의 필요",
};
