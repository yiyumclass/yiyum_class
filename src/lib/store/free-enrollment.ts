import "server-only";

export type PaymentMode = "free" | "toss_test" | "toss_live";

let hasLoggedPaymentModeWarning = false;

/**
 * 판매 가격은 항상 DB 값을 그대로 사용한다.
 * 무료 상품 여부와 결제 실행 환경은 가격을 덮어쓰지 않고 별도로 판단한다.
 */
export function getPaymentMode(): PaymentMode {
  const mode = process.env.PAYMENT_MODE;
  if (mode === "toss_test" || mode === "toss_live") return mode;
  if (mode !== "free") logPaymentModeWarning(mode);
  return "free";
}

export function isTossPaymentEnabled() {
  return getPaymentMode() !== "free";
}

export function isTossPaymentConfigured() {
  return (
    isTossPaymentEnabled() &&
    Boolean(process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY) &&
    Boolean(process.env.TOSS_SECRET_KEY) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
}

function logPaymentModeWarning(mode: string | undefined): void {
  if (hasLoggedPaymentModeWarning) return;
  hasLoggedPaymentModeWarning = true;

  const label = mode ? `"${mode}"` : "missing";
  console.error(
    `PAYMENT_MODE is ${label}; falling back to "free". Expected "free", "toss_test", or "toss_live".`
  );
}
