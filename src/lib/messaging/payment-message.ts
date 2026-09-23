/** 고객이 등록한 승인 템플릿. 본문과 버튼은 SOLAPI에서 관리한다. */
const templates: Record<string, { templateId: string; product: string }> = {
  "sns-monetization": { templateId: "KA01TP260922040813314fVYjYZjPBWX", product: "베이직 클래스" },
  "sns-monetization-feedback": { templateId: "KA01TP260922041539999n9FFB1w868L", product: "부스터 클래스" },
  "sns-monetization-ultra": { templateId: "KA01TP260922041738461z54SAXgqqVp", product: "프리미엄 클래스" },
};

export type PaymentMessageOrder = {
  order_id: string;
  order_uid: string;
  user_id: string;
  product_slug: string;
  amount: number;
  approved_at: string;
  attempt_id: string;
};

export function buildPaymentMessage(order: PaymentMessageOrder, name: string) {
  const template = Object.hasOwn(templates, order.product_slug) ? templates[order.product_slug] : null;
  if (!template) throw new Error("unsupported_product");
  if (!Number.isSafeInteger(order.amount) || order.amount <= 0) throw new Error("invalid_amount");
  const date = new Date(order.approved_at);
  if (Number.isNaN(date.getTime())) throw new Error("invalid_payment_date");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return {
    templateId: template.templateId,
    variables: {
      "#{name}": name.trim() || "회원",
      "#{product}": template.product,
      "#{amount}": new Intl.NumberFormat("ko-KR").format(order.amount),
      "#{paymentDate}": `${value("year")}.${value("month")}.${value("day")} ${value("hour")}:${value("minute")}:${value("second")}`,
    },
  };
}

export type PaymentMessageOutcome = {
  status: "accepted" | "failed" | "unknown";
  code: string | null;
  messageId?: string;
  groupId?: string;
};

type PreparedMessage = ReturnType<typeof buildPaymentMessage> & { to: string };

export type PaymentMessagePorts = {
  prepare: (order: PaymentMessageOrder) => Promise<PreparedMessage>;
  beginSend: (order: PaymentMessageOrder, templateId: string) => Promise<boolean>;
  send: (message: PreparedMessage, order: PaymentMessageOrder) => Promise<{ messageId: string; groupId: string }>;
  finish: (order: PaymentMessageOrder, outcome: PaymentMessageOutcome) => Promise<void>;
  isDefiniteRejection: (error: unknown) => boolean;
  log: (code: string, orderId: string) => void;
};

/** SOLAPI 접수 후 DB 기록 실패를 발송 실패로 오인해 재시도하지 않는다. */
export async function deliverPaymentMessage(order: PaymentMessageOrder, ports: PaymentMessagePorts) {
  let message: PreparedMessage;
  try {
    message = await ports.prepare(order);
  } catch {
    await finishSafely({ status: "failed", code: "PREPARATION_FAILED" });
    return;
  }

  try {
    if (!(await ports.beginSend(order, message.templateId))) return;
  } catch {
    // DB 응답 유실로 이미 sending일 수 있다. 임의로 failed로 되돌리지 않는다.
    ports.log("CLAIM_TRANSITION_FAILED", order.order_id);
    return;
  }

  let outcome: PaymentMessageOutcome;
  try {
    const result = await ports.send(message, order);
    outcome = { status: "accepted", code: null, ...result };
  } catch (error) {
    outcome = ports.isDefiniteRejection(error)
      ? { status: "failed", code: "PROVIDER_REJECTED" }
      : { status: "unknown", code: "PROVIDER_RESULT_UNKNOWN" };
  }
  await finishSafely(outcome);

  async function finishSafely(outcome: PaymentMessageOutcome) {
    try { await ports.finish(order, outcome); }
    catch { ports.log("RESULT_PERSIST_FAILED", order.order_id); }
  }
}
