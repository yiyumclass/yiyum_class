import "server-only";

import { SolapiMessageService } from "solapi";
import { readAuthUserMobileNumber } from "@/lib/messaging/phone";

type AuthUserContact = Parameters<typeof readAuthUserMobileNumber>[0];

export type WelcomeMessageResult =
  | { status: "sent" }
  | {
      status: "skipped";
      reason: "invalid_recipient" | "not_configured";
    };

type SolapiWelcomeConfig = {
  apiKey: string;
  apiSecret: string;
  pfId: string;
  templateId: string;
};

/**
 * 신규 회원에게 SOLAPI 카카오 알림톡을 보낸다.
 *
 * 알림톡 템플릿 본문은 SOLAPI 콘솔에서 관리한다. 문자 대체발송을 끄므로
 * 등록 발신번호 없이 동작하며, 이 함수에는 승인된 알림톡 templateId가 필요하다.
 */
export async function sendSignupWelcomeMessage(
  user: AuthUserContact
): Promise<WelcomeMessageResult> {
  const recipient = readAuthUserMobileNumber(user);
  if (!recipient) {
    return { status: "skipped", reason: "invalid_recipient" };
  }

  const config = readSolapiWelcomeConfig();
  if (!config) {
    return { status: "skipped", reason: "not_configured" };
  }

  const service = new SolapiMessageService(config.apiKey, config.apiSecret);
  await service.sendOne({
    to: recipient,
    kakaoOptions: {
      pfId: config.pfId,
      templateId: config.templateId,
      variables: {},
      disableSms: true,
    },
  });

  return { status: "sent" };
}

function readSolapiWelcomeConfig(): SolapiWelcomeConfig | null {
  const apiKey = process.env.SOLAPI_API_KEY?.trim();
  const apiSecret = process.env.SOLAPI_API_SECRET?.trim();
  const pfId = process.env.SOLAPI_PF_ID?.trim();
  const templateId = process.env.SOLAPI_WELCOME_TEMPLATE_ID?.trim();

  if (!apiKey || !apiSecret || !pfId || !templateId) return null;
  return { apiKey, apiSecret, pfId, templateId };
}
