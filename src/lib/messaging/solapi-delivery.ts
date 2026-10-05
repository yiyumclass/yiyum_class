import { createSolapiAuthorization, type SolapiConfig } from "./solapi-payment-transport.ts";

export type DeliveryTarget = {
  orderUid: string;
  templateId: string | null;
  messageId: string | null;
  groupId: string | null;
  startedAt: string;
};

export type DeliveryResult = {
  status: "accepted" | "delivered" | "delivery_failed" | "unknown" | "review";
  code: string | null;
  providerCode: string | null;
  messageId?: string;
  groupId?: string;
  deliveredAt?: string;
};

export async function lookupPaymentDelivery(
  config: SolapiConfig,
  target: DeliveryTarget,
  request: typeof fetch = fetch,
  now = Date.now()
): Promise<DeliveryResult> {
  const startedAt = Date.parse(target.startedAt);
  if (!target.templateId || !Number.isFinite(startedAt)) return review("DELIVERY_METADATA_MISSING");
  const url = new URL("https://api.solapi.com/messages/v4/list");
  url.searchParams.set("limit", "500");
  if (target.messageId) url.searchParams.set("messageId", target.messageId);
  else {
    url.searchParams.set("startDate", new Date(startedAt - 60_000).toISOString());
    url.searchParams.set("endDate", new Date(now).toISOString());
    url.searchParams.set("criteria", "kakaoTemplateId,type");
    url.searchParams.set("cond", "eq,eq");
    url.searchParams.set("value", `${target.templateId},ATA`);
  }
  const matches: Record<string, unknown>[] = [];
  let complete = false;
  for (let page = 0; page < 2; page += 1) {
    const response = await request(url, {
      method: "GET",
      headers: { Authorization: createSolapiAuthorization(config) },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("DELIVERY_LOOKUP_FAILED");
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !isRecord(payload.messageList)) throw new Error("DELIVERY_RESPONSE_INVALID");
    for (const message of Object.values(payload.messageList)) {
      if (!isRecord(message)) continue;
      const fields = isRecord(message.customFields) ? message.customFields : {};
      if (target.messageId ? message.messageId === target.messageId : fields.orderId === target.orderUid) matches.push(message);
    }
    if (!payload.nextKey) { complete = true; break; }
    if (typeof payload.nextKey !== "string") throw new Error("DELIVERY_RESPONSE_INVALID");
    url.searchParams.set("startKey", payload.nextKey);
  }
  if (!complete) return review("DELIVERY_HISTORY_INCOMPLETE");
  if (matches.length > 1) return review("MULTIPLE_PROVIDER_MESSAGES");
  if (matches.length === 0) {
    return now - startedAt >= 24 * 60 * 60_000
      ? review("DELIVERY_RESULT_NOT_FOUND")
      : { status: target.messageId ? "accepted" : "unknown", code: "DELIVERY_RESULT_PENDING", providerCode: null };
  }
  const message = matches[0];
  const fields = isRecord(message.customFields) ? message.customFields : {};
  const kakao = isRecord(message.kakaoOptions) ? message.kakaoOptions : {};
  if (fields.orderId !== target.orderUid || message.type !== "ATA" || message.replacement === true
    || kakao.pfId !== config.pfId || kakao.templateId !== target.templateId
    || typeof message.messageId !== "string" || !message.messageId
    || typeof message.groupId !== "string" || !message.groupId
    || target.groupId && message.groupId !== target.groupId) return review("DELIVERY_IDENTITY_MISMATCH");
  const providerCode = String(message.statusCode ?? "");
  const identifiers = { messageId: message.messageId, groupId: message.groupId, providerCode };
  if (providerCode === "4000") return {
    ...identifiers, status: "delivered", code: null,
    deliveredAt: typeof message.dateReceived === "string" && Number.isFinite(Date.parse(message.dateReceived)) ? message.dateReceived : new Date(now).toISOString(),
  };
  if (["2000", "3000"].includes(providerCode)) return now - startedAt >= 24 * 60 * 60_000
    ? { ...identifiers, status: "review", code: "DELIVERY_OVERDUE" }
    : { ...identifiers, status: "accepted", code: null };
  if (/^[123]\d{3}$/.test(providerCode)) return { ...identifiers, status: "delivery_failed", code: `SOLAPI_${providerCode}` };
  return { ...identifiers, status: "review", code: "DELIVERY_STATUS_UNRECOGNIZED" };
}

function review(code: string): DeliveryResult {
  return { status: "review", code, providerCode: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
