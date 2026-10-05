import { createHash } from "node:crypto";

export type AdminKakaoTemplate = {
  id: string;
  name: string;
  content: string;
  extra: string;
  title: string;
  subtitle: string;
  buttons: { name: string; mobile: string; desktop: string }[];
  variables: string[];
  fingerprint: string;
};

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAdminTemplate(value: unknown, channelId: string): AdminKakaoTemplate {
  if (!record(value) || value.channelId !== channelId || value.assignType !== "CHANNEL"
    || value.status !== "APPROVED" || value.isHidden !== false || value.isDeleted === true) {
    throw new Error("TEMPLATE_UNAVAILABLE");
  }
  if (typeof value.templateId !== "string" || !/^[\w-]{1,80}$/.test(value.templateId)
    || typeof value.name !== "string" || typeof value.content !== "string" || !value.content.trim()) {
    throw new Error("TEMPLATE_INVALID");
  }
  if (!["BA", "EX"].includes(String(value.messageType)) || !["NONE", "TEXT"].includes(String(value.emphasizeType))
    || value.imageId || value.header || value.ad
    || (Array.isArray(value.quickReplies) && value.quickReplies.length)
    || (record(value.highlight) && Object.values(value.highlight).some(Boolean))
    || (record(value.item) && (Array.isArray(value.item.list) && value.item.list.length
      || record(value.item.summary) && Object.values(value.item.summary).some(Boolean)))) {
    throw new Error("TEMPLATE_UNSUPPORTED");
  }
  if (!Array.isArray(value.buttons) || value.buttons.length > 5) throw new Error("TEMPLATE_UNSUPPORTED");
  const buttons = value.buttons.map(button => {
    if (!record(button) || button.buttonType !== "WL" || typeof button.buttonName !== "string"
      || typeof button.linkMo !== "string" || button.linkAnd || button.linkIos || button.chatExtra) {
      throw new Error("TEMPLATE_UNSUPPORTED");
    }
    return { name: button.buttonName, mobile: button.linkMo, desktop: typeof button.linkPc === "string" ? button.linkPc : "" };
  });
  const extra = typeof value.extra === "string" ? value.extra : "";
  const title = typeof value.emphasizeTitle === "string" ? value.emphasizeTitle : "";
  const subtitle = typeof value.emphasizeSubtitle === "string" ? value.emphasizeSubtitle : "";
  const texts = [value.content, extra, title, subtitle, ...buttons.flatMap(button => [button.name, button.mobile, button.desktop])];
  const variables = [...new Set(texts.flatMap(text => text.match(/#\{[^{}]+\}/g) ?? []))].sort();
  if (variables.length > 20 || variables.some(name => name.length > 80)) throw new Error("TEMPLATE_UNSUPPORTED");
  if (Array.isArray(value.variables) && value.variables.some(variable => {
    if (!record(variable) || typeof variable.name !== "string") return true;
    const name = variable.name.startsWith("#{") ? variable.name : `#{${variable.name}}`;
    return !variables.includes(name);
  })) throw new Error("TEMPLATE_UNSUPPORTED");
  const template = { id: value.templateId, name: value.name, content: value.content, extra, title, subtitle, buttons, variables };
  return { ...template, fingerprint: createHash("sha256").update(JSON.stringify(template)).digest("hex") };
}

export function renderAdminTemplate(template: AdminKakaoTemplate, input: unknown) {
  if (!record(input) || Object.keys(input).length !== template.variables.length) throw new Error("VARIABLES_INVALID");
  const variables: Record<string, string> = {};
  for (const name of template.variables) {
    const value = input[name];
    if (typeof value !== "string" || !value.trim() || value.length > 500
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]|#\{/.test(value)) throw new Error("VARIABLES_INVALID");
    variables[name] = value.trim();
  }
  const render = (text: string) => text.replace(/#\{[^{}]+\}/g, name => variables[name]);
  const content = render(template.content);
  const extra = render(template.extra);
  if (content.length + extra.length > 1000) throw new Error("MESSAGE_TOO_LONG");
  const buttons = template.buttons.map(button => {
    const rendered = { name: render(button.name), mobile: render(button.mobile), desktop: render(button.desktop) };
    for (const link of [rendered.mobile, rendered.desktop].filter(Boolean)) {
      let url: URL;
      try { url = new URL(link); } catch { throw new Error("BUTTON_URL_INVALID"); }
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("BUTTON_URL_INVALID");
    }
    return rendered;
  });
  return { content, extra, title: render(template.title), subtitle: render(template.subtitle), buttons, variables };
}

export function normalizeCashVariables(input: Record<string, string>, now = new Date()) {
  const amount = input["#{amount}"]?.trim();
  if (!amount || !/^\d{1,9}$/.test(amount) || Number(amount) <= 0) throw new Error("CASH_AMOUNT_INVALID");
  const date = input["#{paymentDate}"]?.trim();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("CASH_DATE_INVALID");
  const parsed = new Date(`${date}T00:00:00+09:00`);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  if (!Number.isFinite(parsed.getTime()) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
    || date > today || date < "2020-01-01") throw new Error("CASH_DATE_INVALID");
  return { ...input, "#{amount}": Number(amount).toLocaleString("ko-KR"), "#{paymentDate}": date.replaceAll("-", ".") };
}
