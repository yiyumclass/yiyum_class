import assert from "node:assert/strict";
import test from "node:test";
import { resolveProgressProductSlug } from "../src/lib/learning/progress-request.ts";

test("챕터 상품 진도 요청은 상품 slug로 권한을 확인한다", () => {
  assert.equal(
    resolveProgressProductSlug("sns-monetization", "sns-monetization-chapter-1"),
    "sns-monetization-chapter-1"
  );
});

test("상품 slug가 없는 구형 진도 요청은 원본 강의 slug를 사용한다", () => {
  assert.equal(resolveProgressProductSlug("sns-monetization", undefined), "sns-monetization");
  assert.equal(resolveProgressProductSlug("sns-monetization", "  "), "sns-monetization");
});
