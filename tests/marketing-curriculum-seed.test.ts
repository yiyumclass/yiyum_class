import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { snsMarketingCurriculumSeed } from "../src/lib/store/marketing-curriculum-seed.ts";

test("DB 초기 데이터와 공개 페이지의 초기 데이터가 같고 재실행으로 편집 내용을 덮어쓰지 않는다", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20261005102000_seed_marketing_curriculum.sql", import.meta.url), "utf8");
  const serialized = migration.match(/\$curriculum\$\s*([\s\S]*?)\s*\$curriculum\$/)?.[1];
  assert.ok(serialized);
  assert.deepEqual(JSON.parse(serialized), snsMarketingCurriculumSeed);
  assert.match(migration, /on conflict \(curriculum_key\) do nothing/);
  assert.doesNotMatch(migration, /(?:update|delete from) public\.(?:lessons|courses|course_sections|products)/i);
});

test("고객이 제공한 커리큘럼은 10챕터와 중복 없는 1~89강을 유지한다", () => {
  assert.equal(snsMarketingCurriculumSeed.length, 10);
  const items = snsMarketingCurriculumSeed.flatMap((chapter) => chapter.items);
  const numbered = items.filter((item) => item.lessonNumber !== null);
  assert.deepEqual(numbered.map((item) => item.lessonNumber), Array.from({ length: 89 }, (_, index) => index + 1));
  assert.equal(new Set(items.map((item) => item.key)).size, items.length);
  assert.equal(new Set(snsMarketingCurriculumSeed.map((chapter) => chapter.key)).size, 10);
});

test("번호가 붙은 과제는 원래 강 번호를 유지하고 별도 과제는 강 수에 추가하지 않는다", () => {
  const assignments = snsMarketingCurriculumSeed.flatMap((chapter) => chapter.items).filter((item) => item.kind === "assignment");
  assert.deepEqual(assignments.filter((item) => item.lessonNumber !== null).map((item) => item.lessonNumber), [5, 11, 15, 23]);
  assert.equal(assignments.length, 17);
  assert.equal(assignments.filter((item) => item.lessonNumber === null).length, 13);
  assert.match(assignments[0].title, /10\/12\(월\) 과제 9개/);
  assert.match(assignments.at(-1)!.title, /12\/7\(월\) 과제/);
});

test("각 챕터의 강 번호 경계와 고객이 준 주요 문구를 보존한다", () => {
  assert.deepEqual(snsMarketingCurriculumSeed.map((chapter) => {
    const numbered = chapter.items.filter((item) => item.lessonNumber !== null);
    return [numbered[0].lessonNumber, numbered.at(-1)!.lessonNumber];
  }), [[1, 15], [16, 23], [24, 26], [27, 34], [35, 39], [40, 50], [51, 58], [59, 70], [71, 82], [83, 89]]);
  const items = snsMarketingCurriculumSeed.flatMap((chapter) => chapter.items);
  assert.equal(items.find((item) => item.lessonNumber === 19)?.title, "삼각대 편 : 실패 없이 고르는 이윰 PICK 삼각대");
  assert.equal(items.find((item) => item.lessonNumber === 89)?.title, "오래 살아남는 크리에이터의 멘탈 관리");
});
