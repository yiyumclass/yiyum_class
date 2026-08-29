import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const landingPath = new URL("../src/app/page.tsx", import.meta.url);
const metadataPath = new URL("../src/app/layout.tsx", import.meta.url);
const fallbackCatalogPath = new URL("../src/lib/learning/catalog.ts", import.meta.url);

test("landing presents income-related examples as personal history without guarantees", async () => {
  const landing = await readFile(landingPath, "utf8");

  assert.match(landing, /강사 개인 운영 사례/);
  assert.match(landing, /강사의 개인적인 과거 경험/);
  assert.match(landing, /특정 경제적 성과를 보장하지 않으며/);
  assert.match(landing, /첫 무가 협찬/);
  assert.match(landing, /가구 협찬 제안을 하루 3~5건 받은 경험/);
  assert.match(landing, /원고료를 단계적으로 높여 협상한 경험/);
  assert.match(landing, /가전 협찬까지 확장/);
  assert.doesNotMatch(landing, /작은 계정으로도 수익화 가능/);
  assert.doesNotMatch(landing, /수강생들의 실제 수익화 인증/);
  assert.doesNotMatch(landing, /협찬과 원고료를 받았어요/);
  assert.doesNotMatch(landing, /원고료 5만~50만원/);
  assert.doesNotMatch(landing, /10만\s*→\s*20만/);
  assert.doesNotMatch(landing, /assets\/proof/);
  assert.doesNotMatch(landing, /reviews\/review-1[12]\.jpg/);
});

test("public metadata and fallback curriculum do not advertise guaranteed outcomes", async () => {
  const [metadata, fallbackCatalog] = await Promise.all([
    readFile(metadataPath, "utf8"),
    readFile(fallbackCatalogPath, "utf8"),
  ]);
  const publicCopy = `${metadata}\n${fallbackCatalog}`;

  assert.doesNotMatch(publicCopy, /1,000대부터 수익화/);
  assert.doesNotMatch(publicCopy, /100% 수익화 가능/);
  assert.doesNotMatch(publicCopy, /광고 단가 10배/);
  assert.doesNotMatch(publicCopy, /무조건 답장/);
});
