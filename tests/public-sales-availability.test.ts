import assert from "node:assert/strict";
import test from "node:test";
import { isPublicProductAvailable } from "../src/lib/store/public-sales-availability.ts";

test("유료 전자책과 컨설팅은 공개 판매하지 않는다", () => {
  assert.equal(isPublicProductAvailable("ebook", 10000), false);
  assert.equal(isPublicProductAvailable("consulting", 10000), false);
  assert.equal(isPublicProductAvailable("consulting", 0), false);
});

test("온라인 강의와 무료자료는 계속 제공한다", () => {
  assert.equal(isPublicProductAvailable("course", 930000), true);
  assert.equal(isPublicProductAvailable("course", 0), true);
  assert.equal(isPublicProductAvailable("ebook", 0), true);
});
