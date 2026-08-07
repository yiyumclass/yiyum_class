import assert from "node:assert/strict";
import test from "node:test";
import { formatKrw, resolveSalePrice } from "../src/lib/store/pricing.ts";

test("정가가 없으면 세일이 아니다", () => {
  const sale = resolveSalePrice(300000, null);

  assert.equal(sale.isOnSale, false);
  assert.equal(sale.listPriceKrw, null);
  assert.equal(sale.discountPercent, null);
});

test("정가가 판매가와 같으면 세일이 아니다", () => {
  // 취소선 옆에 같은 숫자가 두 번 뜨면 할인으로 읽히지 않고 오류로 읽힌다.
  const sale = resolveSalePrice(300000, 300000);

  assert.equal(sale.isOnSale, false);
  assert.equal(sale.listPriceKrw, null);
});

test("정가가 판매가보다 낮으면 세일로 보지 않는다", () => {
  // DB 제약이 막지만, 제약 이전에 들어간 값이 화면에서 취소선을 뒤집으면 안 된다.
  const sale = resolveSalePrice(300000, 100000);

  assert.equal(sale.isOnSale, false);
  assert.equal(sale.listPriceKrw, null);
});

test("정가가 판매가보다 높으면 할인율을 내림해 계산한다", () => {
  const sale = resolveSalePrice(187000, 550000);

  assert.equal(sale.isOnSale, true);
  assert.equal(sale.listPriceKrw, 550000);
  assert.equal(sale.discountPercent, 66);
});

test("무료 상품도 정가가 있으면 세일로 본다", () => {
  const sale = resolveSalePrice(0, 50000);

  assert.equal(sale.isOnSale, true);
  assert.equal(sale.discountPercent, 100);
});

test("원화는 천 단위로 끊어 적는다", () => {
  assert.equal(formatKrw(187000), "187,000");
  assert.equal(formatKrw(0), "0");
});
