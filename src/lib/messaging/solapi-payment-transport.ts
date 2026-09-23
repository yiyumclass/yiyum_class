import { createHmac, randomBytes } from "node:crypto";

export class PaymentMessageRejected extends Error {}

type MessageRequest = {
  to: string;
  templateId: string;
  variables: Record<string, string>;
  orderId: string;
};

type SolapiConfig = { apiKey: string; apiSecret: string; pfId: string };

/** SDK의 POST 자동 재시도를 피한다. 접수 여부가 불명확하면 상위에서 수동 확인 대상으로 기록한다. */
export async function sendPaymentMessageOnce(
  config: SolapiConfig,
  message: MessageRequest,
  request: typeof fetch = fetch
): Promise<{ messageId: string; groupId: string }> {
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", config.apiSecret).update(date + salt).digest("hex");
  const response = await request("https://api.solapi.com/messages/v4/send-many/detail", {
    method: "POST",
    headers: {
      Authorization: `HMAC-SHA256 apiKey=${config.apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      messages: [{
        to: message.to,
        type: "ATA",
        customFields: { orderId: message.orderId },
        kakaoOptions: {
          pfId: config.pfId,
          templateId: message.templateId,
          variables: message.variables,
          disableSms: true,
        },
      }],
      showMessageList: true,
      allowDuplicates: false,
    }),
  });
  if ([400, 401, 403, 404, 422].includes(response.status)) throw new PaymentMessageRejected("PROVIDER_REJECTED");
  if (!response.ok) throw new Error("PROVIDER_RESULT_UNKNOWN");
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error("INVALID_PROVIDER_RESPONSE");
  const failed = body.failedMessageList;
  const messages = body.messageList;
  if (Array.isArray(failed) && failed.length === 1 && (!Array.isArray(messages) || messages.length === 0)) {
    throw new PaymentMessageRejected("PROVIDER_REJECTED");
  }
  const item = Array.isArray(messages) && messages.length === 1 ? messages[0] : null;
  const group = body.groupInfo;
  if (!Array.isArray(failed) || failed.length !== 0 || !isRecord(item) || item.statusCode !== "2000"
      || typeof item.messageId !== "string" || !item.messageId
      || !isRecord(group) || typeof group.groupId !== "string" || !group.groupId) {
    throw new Error("INVALID_PROVIDER_RESPONSE");
  }
  // accepted는 SOLAPI 접수 성공이며 최종 카카오 수신 성공을 의미하지 않는다.
  return { messageId: item.messageId, groupId: group.groupId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
