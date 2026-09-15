// 공개 판매만 제어한다. 기존 구매자의 이용권과 관리자 상품 관리는 유지한다.
export const publicSalesAvailability = {
  ebooks: false,
  consulting: false,
};

export function isPublicProductAvailable(productType: string, priceKrw: number): boolean {
  if (productType === "consulting") return publicSalesAvailability.consulting;
  if (productType === "ebook" && priceKrw > 0) return publicSalesAvailability.ebooks;
  return true;
}
