import { createSolapiAuthorization, type SolapiConfig } from "./solapi-payment-transport.ts";
import { parseAdminTemplate, record, type AdminKakaoTemplate } from "./admin-notification-template.ts";
import { normalizeKoreanMobileNumber } from "./phone.ts";

async function read(config: SolapiConfig, url: URL, request: typeof fetch) {
  const response = await request(url, {
    headers: { Authorization: createSolapiAuthorization(config) },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("SOLAPI_LOOKUP_FAILED");
  const result: unknown = await response.json();
  if (!record(result)) throw new Error("SOLAPI_RESPONSE_INVALID");
  return result;
}

export async function listAdminTemplates(config: SolapiConfig, request: typeof fetch = fetch) {
  const url = new URL("https://api.solapi.com/kakao/v2/templates/");
  for (const [key, value] of Object.entries({ channelId: config.pfId, status: "APPROVED", isMine: "true", isHidden: "false", limit: "100" })) url.searchParams.set(key, value);
  const templates: AdminKakaoTemplate[] = [];
  let unsupported = 0;
  for (let page = 0; page < 3; page += 1) {
    const result = await read(config, url, request);
    if (!Array.isArray(result.templateList)) throw new Error("SOLAPI_RESPONSE_INVALID");
    for (const item of result.templateList) {
      try { templates.push(parseAdminTemplate(item, config.pfId)); }
      catch { unsupported += 1; }
    }
    if (!result.nextKey) return { templates, unsupported };
    if (typeof result.nextKey !== "string") throw new Error("SOLAPI_RESPONSE_INVALID");
    url.searchParams.set("startKey", result.nextKey);
  }
  throw new Error("TEMPLATE_LIST_INCOMPLETE");
}

export async function getAdminTemplate(config: SolapiConfig, templateId: string, request: typeof fetch = fetch) {
  if (!/^[\w-]{1,80}$/.test(templateId)) throw new Error("TEMPLATE_INVALID");
  return parseAdminTemplate(await read(config, new URL(`https://api.solapi.com/kakao/v2/templates/${templateId}`), request), config.pfId);
}

export async function hasPreviousTemplateMessage(config: SolapiConfig, phone: string, templateId: string, request: typeof fetch = fetch) {
  const url = new URL("https://api.solapi.com/messages/v4/list");
  url.searchParams.set("to", phone);
  url.searchParams.set("criteria", "kakaoTemplateId,type");
  url.searchParams.set("cond", "eq,eq");
  url.searchParams.set("value", `${templateId},ATA`);
  url.searchParams.set("limit", "100");
  for (let page = 0; page < 2; page += 1) {
    const result = await read(config, url, request);
    if (!record(result.messageList)) throw new Error("SOLAPI_RESPONSE_INVALID");
    for (const message of Object.values(result.messageList)) {
      if (!record(message) || !record(message.kakaoOptions)) throw new Error("SOLAPI_RESPONSE_INVALID");
      if (normalizeKoreanMobileNumber(message.to) === phone && message.type === "ATA"
        && message.kakaoOptions.pfId === config.pfId && message.kakaoOptions.templateId === templateId) return true;
    }
    if (!result.nextKey) return false;
    if (typeof result.nextKey !== "string") throw new Error("SOLAPI_RESPONSE_INVALID");
    url.searchParams.set("startKey", result.nextKey);
  }
  throw new Error("DELIVERY_HISTORY_INCOMPLETE");
}
