import "server-only";

import {
  isTossPaymentEnabled,
} from "./payment-mode";

export { getPaymentMode, isTossPaymentEnabled } from "./payment-mode";
export type { PaymentMode } from "./payment-mode";

/**
 * 판매 가격은 항상 DB 값을 그대로 사용한다.
 * 무료 상품 여부와 결제 실행 환경은 가격을 덮어쓰지 않고 별도로 판단한다.
 */
export function isTossPaymentConfigured() {
  return (
    isTossPaymentEnabled() &&
    Boolean(process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY) &&
    Boolean(process.env.TOSS_SECRET_KEY) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
}
