/** 결제 연동 전 운영하는 임시 무료 신청 모드. */
export const FREE_ENROLLMENT_MODE = true;

export function resolveSellingPrice(priceKrw: number) {
  return FREE_ENROLLMENT_MODE ? 0 : priceKrw;
}
