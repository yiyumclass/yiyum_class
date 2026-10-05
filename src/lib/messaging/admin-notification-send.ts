import { PaymentMessageRejected } from "./solapi-payment-transport.ts";

export type AdminSendOutcome = {
  status: "accepted" | "rejected" | "unknown";
  messageId?: string;
  groupId?: string;
};

export async function sendAdminNotificationOnce(ports: {
  begin: () => Promise<boolean>;
  send: () => Promise<{ messageId: string; groupId: string }>;
  finish: (outcome: AdminSendOutcome) => Promise<void>;
}): Promise<AdminSendOutcome["status"] | "already_started"> {
  if (!await ports.begin()) return "already_started";
  let outcome: AdminSendOutcome;
  try { outcome = { status: "accepted", ...await ports.send() }; }
  catch (error) { outcome = { status: error instanceof PaymentMessageRejected ? "rejected" : "unknown" }; }
  try { await ports.finish(outcome); }
  catch { return "unknown"; }
  return outcome.status;
}
