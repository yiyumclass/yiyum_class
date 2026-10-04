export const PAYMENT_VERIFICATION_SLUG = "admin-payment-verification-100";
export const PAYMENT_VERIFICATION_AMOUNT = 100;

export function isPaymentVerificationProduct(slug: string) {
  return slug === PAYMENT_VERIFICATION_SLUG;
}
