export type PaymentMode = "free" | "toss_test" | "toss_live" | "invalid";

let hasLoggedPaymentModeWarning = false;

export function getPaymentMode(): PaymentMode {
  const mode = process.env.PAYMENT_MODE;
  if (mode === "free" || mode === "toss_test" || mode === "toss_live") return mode;
  if (!hasLoggedPaymentModeWarning) {
    hasLoggedPaymentModeWarning = true;
    const label = mode ? `"${mode}"` : "missing";
    console.error(
      `PAYMENT_MODE is ${label}; payment is disabled. Expected "free", "toss_test", or "toss_live".`
    );
  }
  return "invalid";
}

export function isTossPaymentEnabled() {
  const mode = getPaymentMode();
  return mode === "toss_test" || mode === "toss_live";
}
