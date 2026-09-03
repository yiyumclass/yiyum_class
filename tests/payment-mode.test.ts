import assert from "node:assert/strict";
import test from "node:test";
import {
  getPaymentMode,
  isTossPaymentEnabled,
} from "../src/lib/store/payment-mode.ts";

function withPaymentMode(value: string | undefined, callback: () => void) {
  const previous = process.env.PAYMENT_MODE;
  if (value === undefined) {
    delete process.env.PAYMENT_MODE;
  } else {
    process.env.PAYMENT_MODE = value;
  }
  try {
    callback();
  } finally {
    if (previous === undefined) delete process.env.PAYMENT_MODE;
    else process.env.PAYMENT_MODE = previous;
  }
}

test("PAYMENT_MODE가 명시적으로 free이면 무료 모드다", () => {
  withPaymentMode("free", () => {
    assert.equal(getPaymentMode(), "free");
    assert.equal(isTossPaymentEnabled(), false);
  });
});

test("PAYMENT_MODE가 Toss 모드이면 결제를 활성화한다", () => {
  withPaymentMode("toss_live", () => {
    assert.equal(getPaymentMode(), "toss_live");
    assert.equal(isTossPaymentEnabled(), true);
  });
});

test("PAYMENT_MODE가 누락되거나 오타면 free로 위장하지 않는다", () => {
  withPaymentMode(undefined, () => {
    assert.equal(getPaymentMode(), "invalid");
    assert.equal(isTossPaymentEnabled(), false);
  });
  withPaymentMode("toss-live", () => {
    assert.equal(getPaymentMode(), "invalid");
    assert.equal(isTossPaymentEnabled(), false);
  });
});
