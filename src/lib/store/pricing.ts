/**
 * 정가와 판매가를 화면이 쓰기 좋은 형태로 정리한다.
 *
 * DB 제약이 정가 >= 판매가를 보장하지만, 두 값이 같으면 할인이 아니다. 취소선을
 * 붙일지 여부는 그 판단까지 끝낸 뒤에 정해져야 화면마다 조건이 흩어지지 않는다.
 */
export type SalePrice = {
  priceKrw: number;
  /** 취소선으로 보여줄 정가. 세일이 아니면 null이다. */
  listPriceKrw: number | null;
  isOnSale: boolean;
  /** 내림한 할인율. 세일이 아니면 null이다. */
  discountPercent: number | null;
};

export function resolveSalePrice(
  priceKrw: number,
  listPriceKrw: number | null
): SalePrice {
  const isOnSale =
    listPriceKrw !== null && listPriceKrw > priceKrw && priceKrw >= 0;

  if (!isOnSale || listPriceKrw === null) {
    return {
      priceKrw,
      listPriceKrw: null,
      isOnSale: false,
      discountPercent: null,
    };
  }

  return {
    priceKrw,
    listPriceKrw,
    isOnSale: true,
    discountPercent: Math.floor(((listPriceKrw - priceKrw) / listPriceKrw) * 100),
  };
}

export function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

export function calculateMonthlyInstallmentKrw(
  totalPriceKrw: number,
  months: number
) {
  if (
    !Number.isFinite(totalPriceKrw) ||
    totalPriceKrw < 0 ||
    !Number.isInteger(months) ||
    months <= 0
  ) {
    throw new RangeError("A non-negative total and positive whole month count are required.");
  }

  return Math.round(totalPriceKrw / months);
}
