import "server-only";

import { createHmac, randomUUID } from "node:crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { readKakaoUserId } from "@/lib/auth/account-withdrawal";
import { lookupKakaoPhone } from "@/lib/auth/kakao-phone-request";
import { readAuthUserDisplayName } from "./profile";
import { normalizeCashVariables, record, renderAdminTemplate } from "./admin-notification-template";
import { paymentTemplateProductSlug } from "./payment-message";
import { getAdminTemplate, hasPreviousTemplateMessage, listAdminTemplates } from "./solapi-admin-templates";
import { sendPaymentMessageOnce, type SolapiConfig } from "./solapi-payment-transport";
import { sendAdminNotificationOnce } from "./admin-notification-send";
import { lookupPaymentDelivery } from "./solapi-delivery";
import type { NotificationEntitlement, NotificationHistory, NotificationPanel, NotificationPreview, NotificationPreviewInput } from "./admin-notification-types";

type StoredNotice = {
  id: string;
  actor_user_id: string;
  user_id: string;
  entitlement_id: string | null;
  payment_notice: boolean;
  template_id: string;
  template_name: string;
  template_fingerprint: string;
  channel_id: string;
  variables: Record<string, string>;
  snapshot: NotificationPreview & { context: string };
  recipient_hash: string;
  status: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  send_started_at: string;
  provider_message_id: string | null;
  provider_group_id: string | null;
  delivered_at: string | null;
};

export function adminNotificationsEnabled() {
  return process.env.SOLAPI_ADMIN_NOTIFICATIONS_ENABLED === "true";
}

function config(): SolapiConfig {
  const apiKey = process.env.SOLAPI_API_KEY?.trim();
  const apiSecret = process.env.SOLAPI_API_SECRET?.trim();
  const pfId = process.env.SOLAPI_PF_ID?.trim();
  if (!apiKey || !apiSecret || !pfId) throw new Error("NOTIFICATION_CONFIGURATION_MISSING");
  return { apiKey, apiSecret, pfId };
}

function uuid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error("INVALID_INPUT");
}

async function memberContext(memberId: string) {
  uuid(memberId);
  const admin = getAdminClient();
  const [account, withdrawal, access] = await Promise.all([
    admin.auth.admin.getUserById(memberId),
    admin.from("account_withdrawals").select("user_id").eq("user_id", memberId).maybeSingle(),
    admin.from("product_entitlements").select("id,product_id,source,status,expires_at,products!inner(title,slug)")
      .eq("user_id", memberId).eq("status", "active")
      .returns<{ id: string; product_id: string; source: string; expires_at: string | null; products: { title: string; slug: string } }[]>(),
  ]);
  if (account.error || withdrawal.error || access.error) throw new Error("MEMBER_LOOKUP_FAILED");
  const user = account.data.user;
  if (!user || withdrawal.data || ("deleted_at" in user && user.deleted_at)) throw new Error("ACCOUNT_INACTIVE");
  const entitlements: NotificationEntitlement[] = (access.data ?? [])
    .filter(item => !item.expires_at || Date.parse(item.expires_at) > Date.now())
    .map(item => ({ id: item.id, productId: item.product_id, source: item.source, title: item.products.title, slug: item.products.slug }));
  return { user, name: readAuthUserDisplayName(user), entitlements };
}

async function verifiedPhone(context: Awaited<ReturnType<typeof memberContext>>) {
  const identities = context.user.identities?.filter(identity => identity.provider === "kakao");
  const kakaoUserId = identities?.length === 1 ? readKakaoUserId(identities) : null;
  if (!kakaoUserId) throw new Error("PHONE_CONSENT_REQUIRED");
  const result = await lookupKakaoPhone({ kakaoUserId, adminKey: process.env.KAKAO_ADMIN_KEY });
  if (!result.ok) throw new Error(result.code);
  return result.phone;
}

function recipientHash(phone: string, settings: SolapiConfig) {
  return createHmac("sha256", settings.apiSecret).update(`admin-recipient-v1:${phone}`).digest("hex");
}

function contextStamp(name: string, entitlement: NotificationEntitlement | null) {
  return JSON.stringify({ name, entitlement });
}

export async function loadNotificationHistory(memberId: string): Promise<NotificationHistory[]> {
  uuid(memberId);
  const admin = getAdminClient();
  const [manual, payment] = await Promise.all([
    admin.from("admin_notifications").select("id,template_name,status,created_at,delivered_at").eq("user_id", memberId)
      .neq("status", "draft").order("created_at", { ascending: false }).limit(30),
    admin.from("payment_notifications").select("order_id,template_id,status,created_at,delivered_at,orders!inner(user_id,products(title))")
      .eq("orders.user_id", memberId).order("created_at", { ascending: false }).limit(30)
      .returns<{ order_id: string; template_id: string | null; status: string; created_at: string; delivered_at: string | null; orders: { products: { title: string } } }[]>(),
  ]);
  if (manual.error || payment.error) throw new Error("NOTIFICATION_STORAGE_UNAVAILABLE");
  return [
    ...(manual.data ?? []).map(row => ({ id: row.id, templateName: row.template_name, status: row.status, createdAt: row.created_at, deliveredAt: row.delivered_at, source: "admin" as const })),
    ...(payment.data ?? []).map(row => ({ id: row.order_id, templateName: `${row.orders.products.title} · 수강 안내`, status: row.status, createdAt: row.created_at, deliveredAt: row.delivered_at, source: "payment" as const })),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 30);
}

export async function loadNotificationPanel(memberId: string): Promise<NotificationPanel> {
  const [context, catalog, history] = await Promise.all([memberContext(memberId), listAdminTemplates(config()), loadNotificationHistory(memberId)]);
  return {
    name: context.name, enabled: adminNotificationsEnabled(), entitlements: context.entitlements,
    templates: catalog.templates.map(template => ({ ...template, paymentProductSlug: paymentTemplateProductSlug(template.id) })),
    unsupported: catalog.unsupported, history,
  };
}

async function preventDuplicate(memberId: string, templateId: string, entitlement: NotificationEntitlement | null, paymentNotice: boolean) {
  const admin = getAdminClient();
  const previous = await admin.from("admin_notifications").select("id").eq("user_id", memberId).eq("template_id", templateId).neq("status", "draft").limit(1);
  if (previous.error) throw new Error("NOTIFICATION_STORAGE_UNAVAILABLE");
  if (previous.data?.length) throw new Error("DUPLICATE_NOTIFICATION");
  if (!paymentNotice) return;
  if (!entitlement || entitlement.source !== "admin_grant") throw new Error("AUTOMATIC_PAYMENT_NOTICE");
  const paid = await admin.from("orders").select("id").eq("user_id", memberId).eq("product_id", entitlement.productId).eq("source", "payment").eq("status", "paid").limit(1);
  if (paid.error) throw new Error("NOTIFICATION_STORAGE_UNAVAILABLE");
  if (paid.data?.length) throw new Error("AUTOMATIC_PAYMENT_NOTICE");
  const notices = await admin.from("payment_notifications").select("order_id,orders!inner(user_id,product_id)")
    .eq("orders.user_id", memberId).eq("orders.product_id", entitlement.productId)
    .or("send_started_at.not.is.null,provider_message_id.not.is.null,status.in.(sending,accepted,unknown,delivered,delivery_failed,review)").limit(1);
  if (notices.error) throw new Error("NOTIFICATION_STORAGE_UNAVAILABLE");
  if (notices.data?.length) throw new Error("DUPLICATE_NOTIFICATION");
}

export async function previewAdminNotification(actorId: string, input: NotificationPreviewInput): Promise<NotificationPreview> {
  if (!record(input) || typeof input.templateId !== "string" || !record(input.variables)
    || Object.keys(input.variables).length > 20 || Object.values(input.variables).some(value => typeof value !== "string" || value.length > 500)) throw new Error("INVALID_INPUT");
  uuid(input.memberId);
  if (input.entitlementId !== null) uuid(input.entitlementId);
  const settings = config();
  const [context, template] = await Promise.all([memberContext(input.memberId), getAdminTemplate(settings, input.templateId)]);
  const entitlement = context.entitlements.find(item => item.id === input.entitlementId) ?? null;
  if (input.entitlementId && !entitlement) throw new Error("ENTITLEMENT_UNAVAILABLE");
  const productSlug = paymentTemplateProductSlug(template.id);
  if (productSlug && entitlement?.slug !== productSlug) throw new Error("ENTITLEMENT_UNAVAILABLE");
  if (template.variables.includes("#{product}") && !entitlement) throw new Error("ENTITLEMENT_UNAVAILABLE");
  await preventDuplicate(input.memberId, template.id, entitlement, !!productSlug);
  let variables = { ...input.variables };
  for (const name of ["#{name}", "#{이름}"]) if (template.variables.includes(name)) variables[name] = context.name;
  if (template.variables.includes("#{product}")) variables["#{product}"] = entitlement!.title;
  if (productSlug) variables = normalizeCashVariables(variables);
  const rendered = renderAdminTemplate(template, variables);
  const phone = await verifiedPhone(context);
  if (await hasPreviousTemplateMessage(settings, phone, template.id)) throw new Error("PREVIOUS_PROVIDER_MESSAGE");
  const preview: NotificationPreview = {
    id: randomUUID(), name: context.name, maskedPhone: `${phone.slice(0, 3)}-****-${phone.slice(-4)}`,
    templateName: template.name, content: rendered.content, extra: rendered.extra, title: rendered.title, subtitle: rendered.subtitle, buttons: rendered.buttons,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
  const { error } = await getAdminClient().from("admin_notifications").insert({
    id: preview.id, actor_user_id: actorId, user_id: input.memberId, entitlement_id: entitlement?.id ?? null,
    product_id: entitlement?.productId ?? null, payment_notice: !!productSlug,
    template_id: template.id, template_name: template.name, template_fingerprint: template.fingerprint,
    channel_id: settings.pfId, snapshot: { ...preview, context: contextStamp(context.name, entitlement) }, variables: rendered.variables,
    recipient_hash: recipientHash(phone, settings), recipient_masked: preview.maskedPhone, expires_at: preview.expiresAt,
  });
  if (error) throw new Error("NOTIFICATION_STORAGE_UNAVAILABLE");
  return preview;
}

export async function confirmAdminNotification(actorId: string, draftId: string) {
  if (!adminNotificationsEnabled()) throw new Error("ADMIN_NOTIFICATIONS_DISABLED");
  uuid(draftId);
  const admin = getAdminClient();
  const { data: draft, error } = await admin.from("admin_notifications").select("*").eq("id", draftId).eq("actor_user_id", actorId).maybeSingle<StoredNotice>();
  if (error || !draft) throw new Error("DRAFT_UNAVAILABLE");
  if (draft.status !== "draft") return "already_started";
  if (Date.parse(draft.expires_at) <= Date.now()) throw new Error("PREVIEW_EXPIRED");
  const settings = config();
  const [context, template] = await Promise.all([memberContext(draft.user_id), getAdminTemplate(settings, draft.template_id)]);
  const entitlement = context.entitlements.find(item => item.id === draft.entitlement_id) ?? null;
  if (draft.template_fingerprint !== template.fingerprint || draft.channel_id !== settings.pfId
    || draft.snapshot.context !== contextStamp(context.name, entitlement)) throw new Error("PREVIEW_CHANGED");
  renderAdminTemplate(template, draft.variables);
  await preventDuplicate(draft.user_id, draft.template_id, entitlement, draft.payment_notice);
  const phone = await verifiedPhone(context);
  if (recipientHash(phone, settings) !== draft.recipient_hash) throw new Error("PREVIEW_CHANGED");
  if (await hasPreviousTemplateMessage(settings, phone, draft.template_id)) throw new Error("PREVIOUS_PROVIDER_MESSAGE");
  return sendAdminNotificationOnce({
    async begin() {
      if (!adminNotificationsEnabled()) throw new Error("ADMIN_NOTIFICATIONS_DISABLED");
      const { data, error: beginError } = await admin.rpc("begin_admin_notification_send", { target_id: draft.id, actor_id: actorId });
      if (beginError) {
        const known = ["preview_expired", "account_inactive", "entitlement_unavailable", "automatic_payment_notice", "duplicate_notification"];
        throw new Error(known.includes(beginError.message) ? beginError.message.toUpperCase() : "SEND_START_UNCERTAIN");
      }
      return data === true;
    },
    send: () => sendPaymentMessageOnce(settings, { to: phone, templateId: draft.template_id, variables: draft.variables, orderId: `ADMIN-${draft.id}` }),
    async finish(outcome) {
      const { data, error: finishError } = await admin.from("admin_notifications").update({
        status: outcome.status, provider_message_id: outcome.messageId ?? null, provider_group_id: outcome.groupId ?? null,
        error_code: outcome.status === "accepted" ? null : outcome.status === "rejected" ? "PROVIDER_REJECTED" : "PROVIDER_RESULT_UNKNOWN",
        updated_at: new Date().toISOString(),
      }).eq("id", draft.id).eq("status", "sending").select("id");
      if (finishError || data?.length !== 1) throw new Error("RESULT_PERSIST_FAILED");
    },
  });
}

export async function reconcileAdminNotificationDeliveries(memberId?: string) {
  if (!adminNotificationsEnabled()) return 0;
  if (memberId) uuid(memberId);
  const admin = getAdminClient();
  const settings = config();
  let query = admin.from("admin_notifications").select("*").in("status", ["sending", "accepted", "unknown"])
    .lte("delivery_check_after", new Date().toISOString()).order("delivery_check_after").limit(3);
  if (memberId) query = query.eq("user_id", memberId);
  const { data, error } = await query.returns<StoredNotice[]>();
  if (error) throw new Error("NOTIFICATION_STORAGE_UNAVAILABLE");
  const results = await Promise.all((data ?? []).map(async row => {
    const nextCheck = new Date(Date.now() + 5 * 60_000).toISOString();
    try {
      const result = await lookupPaymentDelivery(settings, {
        orderUid: `ADMIN-${row.id}`, templateId: row.template_id, messageId: row.provider_message_id,
        groupId: row.provider_group_id, startedAt: row.send_started_at,
      });
      const { data: updated, error: updateError } = await admin.from("admin_notifications").update({
        status: result.status, error_code: result.code, provider_status_code: result.providerCode,
        provider_message_id: result.messageId ?? row.provider_message_id, provider_group_id: result.groupId ?? row.provider_group_id,
        delivered_at: result.deliveredAt ?? null, delivery_checked_at: new Date().toISOString(),
        delivery_check_after: nextCheck, updated_at: new Date().toISOString(),
      }).eq("id", row.id).eq("status", row.status).eq("updated_at", row.updated_at).select("id");
      if (updateError) throw new Error("RESULT_PERSIST_FAILED");
      return updated?.length === 1;
    } catch {
      await admin.from("admin_notifications").update({ delivery_check_after: nextCheck }).eq("id", row.id).eq("status", row.status).eq("updated_at", row.updated_at);
      console.error("Admin notification delivery check failed:", row.id);
      return false;
    }
  }));
  return results.filter(Boolean).length;
}

export function adminNotificationError(error: unknown) {
  const messages: Record<string, string> = {
    NOTIFICATION_STORAGE_UNAVAILABLE: "알림톡 저장소를 확인해 주세요. 새 DB 마이그레이션 적용이 필요할 수 있습니다.",
    NOTIFICATION_CONFIGURATION_MISSING: "SOLAPI 서버 설정을 확인해 주세요.",
    ADMIN_NOTIFICATIONS_DISABLED: "관리자 알림톡 발송이 비활성화되어 있습니다. 운영 설정 후 사용할 수 있습니다.",
    PHONE_CONSENT_REQUIRED: "카카오 전화번호 동의가 필요합니다. 고객이 동의한 번호로만 보낼 수 있습니다.",
    PHONE_UNAVAILABLE: "카카오에서 동의된 휴대전화 번호를 확인하지 못했습니다.",
    KAKAO_CONFIGURATION_MISSING: "카카오 어드민 키 설정을 확인해 주세요.",
    DUPLICATE_NOTIFICATION: "이미 이 안내의 발송 이력이 있습니다. 이력을 확인해 주세요. 중복 발송은 차단됩니다.",
    PREVIOUS_PROVIDER_MESSAGE: "SOLAPI에 이 번호·템플릿의 기존 발송 이력이 있어 차단했습니다. SOLAPI에서 해당 이력을 확인해 주세요.",
    AUTOMATIC_PAYMENT_NOTICE: "온라인 결제 안내는 자동 발송 경로에서 관리합니다. 이 화면의 결제 안내는 관리자 지급 수강권의 현금 입금 확인에만 사용합니다.",
    ENTITLEMENT_UNAVAILABLE: "선택한 템플릿에 맞는 유효한 수강권이 필요합니다. 회원 정보를 다시 확인해 주세요.",
    ACCOUNT_INACTIVE: "탈퇴하거나 이용할 수 없는 회원입니다.",
    PREVIEW_EXPIRED: "미리보기 유효시간 5분이 지났습니다. 다시 미리보기 해주세요.",
    PREVIEW_CHANGED: "템플릿·회원·수강권·수신번호가 변경됐습니다. 다시 미리보기 해주세요.",
    CASH_AMOUNT_INVALID: "실제 입금액을 쉼표 없이 양의 정수로 입력해 주세요.",
    CASH_DATE_INVALID: "실제 입금일을 확인해 주세요. 미래 날짜는 사용할 수 없습니다.",
    VARIABLES_INVALID: "템플릿의 모든 입력값을 채워 주세요. 빈 값·추가 변수·500자 초과 입력은 사용할 수 없습니다.",
    MESSAGE_TOO_LONG: "입력값을 포함한 메시지가 1,000자를 초과했습니다.",
    BUTTON_URL_INVALID: "버튼 링크는 유효한 HTTPS 주소여야 합니다.",
    SEND_START_UNCERTAIN: "발송 시작 결과를 확인하지 못했습니다. 재발송하지 말고 발송 이력을 먼저 확인해 주세요.",
    TEMPLATE_UNAVAILABLE: "이 채널에서 사용할 수 있는 승인 템플릿이 아닙니다. 목록을 다시 불러와 주세요.",
    TEMPLATE_UNSUPPORTED: "현재는 기본·강조 텍스트형과 웹 링크 버튼 템플릿만 지원합니다.",
  };
  return error instanceof Error && messages[error.message] || "확인에 실패했습니다. 발송 버튼을 다시 누르기 전에 이력을 확인해 주세요.";
}
