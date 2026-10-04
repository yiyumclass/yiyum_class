import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isPaymentVerificationProduct,
  PAYMENT_VERIFICATION_AMOUNT,
  PAYMENT_VERIFICATION_SLUG,
} from "../src/lib/payments/verification-product.ts";

test("운영 결제 검증은 별도 100원 상품만 대상으로 한다", () => {
  assert.equal(PAYMENT_VERIFICATION_AMOUNT, 100);
  assert.equal(isPaymentVerificationProduct(PAYMENT_VERIFICATION_SLUG), true);
  for (const slug of ["sns-monetization-feedback", "small-account-ebook", "", `${PAYMENT_VERIFICATION_SLUG}-other`]) {
    assert.equal(isPaymentVerificationProduct(slug), false);
  }
});

test("결제 화면과 주문 액션은 동일한 관리자 권한 로더를 사용한다", () => {
  for (const path of ["../src/app/checkout/page.tsx", "../src/app/checkout/actions.ts"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /await loadCheckoutProduct\(productSlug\)/);
  }
  const loader = readFileSync(new URL("../src/lib/store/checkout-products.ts", import.meta.url), "utf8");
  assert.match(loader, /access\.status !== "granted" \|\| access\.admin\.role !== "owner"/);
  assert.match(loader, /\.eq\("status", "draft"\)/);
  assert.match(loader, /\.eq\("price_krw", PAYMENT_VERIFICATION_AMOUNT\)/);
});
