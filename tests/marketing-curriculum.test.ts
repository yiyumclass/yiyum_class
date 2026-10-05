import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as membershipPlans from "../src/lib/store/membership-plans.ts";
import * as curriculumTypes from "../src/lib/store/marketing-curriculum-types.ts";
import * as curriculumData from "../src/lib/store/marketing-curriculum-data.ts";
import * as curriculumValidation from "../src/lib/store/marketing-curriculum-validation.ts";
import { snsMarketingCurriculumSeed } from "../src/lib/store/marketing-curriculum-seed.ts";
import type { PublicCourseCatalogItem } from "../src/lib/store/public-course-catalog";
import type { SaleDetail } from "../src/lib/store/public-sale";

const { countMarketingLessons, marketingCurriculumKeyForProduct } = curriculumTypes;
const { resolveMarketingCurriculumLoad } = curriculumData;
const { validateMarketingCurriculum } = curriculumValidation;

function draft() {
  return structuredClone(snsMarketingCurriculumSeed);
}

function readSource(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function loadModule<Module>(path: string, dependencies: Record<string, unknown>) {
  const exports = {};
  const compiled = ts.transpileModule(readSource(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  runInNewContext(compiled.outputText, {
    exports,
    crypto: globalThis.crypto,
    console: { error: () => {} },
    require: (name: string) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports as Module;
}

test("approved marketing copy preserves all titles, ordering and 89 numbered entries", () => {
  const result = validateMarketingCurriculum(snsMarketingCurriculumSeed);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.chapters, snsMarketingCurriculumSeed);
  assert.equal(countMarketingLessons(result.chapters), 89);
  const assignments = result.chapters.flatMap((chapter) => chapter.items).filter((item) => item.kind === "assignment");
  assert.equal(assignments.length, 17);
  assert.deepEqual(assignments.filter((item) => item.lessonNumber !== null).map((item) => item.lessonNumber), [5, 11, 15, 23]);
});

test("all three membership tiers use the independent SNS marketing key", () => {
  for (const plan of membershipPlans.membershipPlanDefinitions) {
    assert.equal(marketingCurriculumKeyForProduct(plan.slug), "sns-monetization");
  }
  assert.equal(marketingCurriculumKeyForProduct("sns-monetization-chapter-1"), null);
  assert.equal(marketingCurriculumKeyForProduct("yiyum-phone-pass"), null);
});

test("curriculum editing preserves explicit numbers when items and chapters move", () => {
  const chapters = draft();
  chapters.reverse();
  chapters[0].items.reverse();
  const result = validateMarketingCurriculum(chapters);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.chapters, chapters);
  assert.equal(countMarketingLessons(result.chapters), 89);
});

test("validation rejects malformed payloads, blank titles, extra properties and bad kinds", () => {
  for (const input of [null, {}, [], [null], [{ ...draft()[0], lessonId: "actual-lesson-id" }]]) {
    assert.equal(validateMarketingCurriculum(input).ok, false);
  }
  const chapters = draft();
  chapters[0].title = " \n\t ";
  assert.equal(validateMarketingCurriculum(chapters).ok, false);
  chapters[0].title = "가".repeat(201);
  assert.equal(validateMarketingCurriculum(chapters).ok, false);
  chapters[0].title = "  수정한 챕터  ";
  chapters[0].items[0].title = "  수정한 항목  ";
  const valid = validateMarketingCurriculum(chapters);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.chapters[0].title, "수정한 챕터");
    assert.equal(valid.chapters[0].items[0].title, "수정한 항목");
  }
  chapters[0].items[0].title = "😀".repeat(200);
  assert.equal(validateMarketingCurriculum(chapters).ok, true);
  chapters[0].items[0] = { ...chapters[0].items[0], kind: "video" } as never;
  assert.equal(validateMarketingCurriculum(chapters).ok, false);
});

test("validation rejects duplicate keys and numbers including numbered assignments", () => {
  const duplicateChapter = draft();
  duplicateChapter[1].key = duplicateChapter[0].key;
  assert.equal(validateMarketingCurriculum(duplicateChapter).ok, false);
  const duplicateItem = draft();
  duplicateItem[1].items[0].key = duplicateItem[0].items[0].key;
  assert.equal(validateMarketingCurriculum(duplicateItem).ok, false);
  const duplicateNumber = draft();
  duplicateNumber[0].items[0].lessonNumber = 5;
  assert.equal(validateMarketingCurriculum(duplicateNumber).ok, false);
  const invalidKey = draft();
  invalidKey[0].key = "../learning";
  assert.equal(validateMarketingCurriculum(invalidKey).ok, false);
});

test("lesson numbering is required for lessons and optional only for assignments", () => {
  for (const number of [null, 0, -1, 1000, 1.5, NaN, "1"]) {
    const chapters = draft();
    chapters[0].items[0].lessonNumber = number as never;
    assert.equal(validateMarketingCurriculum(chapters).ok, false);
  }
  const chapters = draft();
  chapters[0].items[0].kind = "assignment";
  chapters[0].items[0].lessonNumber = null;
  assert.equal(validateMarketingCurriculum(chapters).ok, true);
  assert.equal(countMarketingLessons(chapters), 88);
});

test("curriculum size limits reject oversized or empty chapter item lists", () => {
  const item = { key: "task", title: "과제", lessonNumber: null, kind: "assignment" as const };
  const chapters = Array.from({ length: 31 }, (_, index) => ({ key: `chapter-${index}`, title: "챕터", items: [{ ...item, key: `item-${index}` }] }));
  assert.equal(validateMarketingCurriculum(chapters).ok, false);
  assert.equal(validateMarketingCurriculum([{ key: "chapter", title: "챕터", items: [] }]).ok, false);
  const tooManyItems = Array.from({ length: 151 }, (_, index) => ({ ...item, key: `item-${index}` }));
  assert.equal(validateMarketingCurriculum([{ key: "chapter", title: "챕터", items: tooManyItems }]).ok, false);
  const tooManyTotal = [0, 1, 2].map((chapterIndex) => ({ key: `chapter-${chapterIndex}`, title: "챕터", items: Array.from({ length: 101 }, (_, itemIndex) => ({ ...item, key: `item-${chapterIndex}-${itemIndex}` })) }));
  assert.equal(validateMarketingCurriculum(tooManyTotal).ok, false);
});

test("only initial missing schema or row uses the approved read-only seed", () => {
  for (const code of ["42P01", "42883", "PGRST202", "PGRST205"]) {
    const result = resolveMarketingCurriculumLoad(null, { code }, snsMarketingCurriculumSeed);
    assert.equal(result.editable, false);
    assert.equal(result.curriculum.source, "seed");
    assert.equal(result.curriculum.version, null);
    assert.equal(countMarketingLessons(result.curriculum.chapters), 89);
  }
  const missing = resolveMarketingCurriculumLoad(null, null, snsMarketingCurriculumSeed);
  assert.equal(missing.editable, false);
  assert.deepEqual(missing.curriculum.chapters, snsMarketingCurriculumSeed);
  const failure = resolveMarketingCurriculumLoad(null, { code: "42501" }, snsMarketingCurriculumSeed);
  assert.equal(failure.editable, false);
  assert.deepEqual(failure.curriculum.chapters, []);
});

test("persisted marketing edits take priority over seed and corrupt rows cannot be edited", () => {
  const chapters = draft();
  chapters[0].title = "운영자가 저장한 제목";
  chapters[0].items[0].title = "저장된 공개 문구";
  const row = { curriculum_key: "sns-monetization", chapters, version: 8, updated_at: "2026-10-05T00:00:00Z" };
  const result = resolveMarketingCurriculumLoad(row, null, snsMarketingCurriculumSeed);
  assert.equal(result.editable, true);
  assert.equal(result.curriculum.version, 8);
  assert.deepEqual(result.curriculum.chapters, chapters);
  assert.equal(resolveMarketingCurriculumLoad({ ...row, version: 0 }, null, snsMarketingCurriculumSeed).editable, false);
  assert.equal(resolveMarketingCurriculumLoad({ ...row, chapters: [] }, null, snsMarketingCurriculumSeed).editable, false);
});

function catalogModule(publicClient: unknown, loadMarketing: () => Promise<curriculumTypes.MarketingCurriculum>) {
  return loadModule<{
    loadPublicCourseCatalog: () => Promise<PublicCourseCatalogItem[]>;
    loadMyCourseBySlug: (client: unknown, slug: string) => Promise<PublicCourseCatalogItem | null>;
  }>("src/lib/store/public-course-catalog.ts", {
    "server-only": {},
    react: { cache: (callback: unknown) => callback },
    "@/lib/learning/catalog": { courses: [] },
    "@/lib/runtime/catalog-fallback": { canUseLocalCatalogFallback: () => false },
    "@/lib/supabase/public": { createPublicClient: () => publicClient },
    "./course-products": { courseProducts: [] },
    "./marketing-curriculum": { loadPublicMarketingCurriculum: loadMarketing },
    "./marketing-curriculum-types": curriculumTypes,
  });
}

const curriculum = resolveMarketingCurriculumLoad(null, null, snsMarketingCurriculumSeed).curriculum;

test("public marketing remains attached to all tiers with no actual course, sections or lessons", async () => {
  const products = membershipPlans.membershipPlanDefinitions.map((plan) => ({
    id: plan.slug, slug: plan.slug, title: plan.title, summary: "소개", price_krw: plan.fallbackPriceKrw,
    list_price_krw: null, status: "active", access_period_days: 365, thumbnail_path: null, detail_path: null, product_type: "course",
  }));
  for (const outline of [{ data: [], error: null }, { data: null, error: { code: "PGRST202", message: "missing" } }]) {
    const client = { rpc: async (name: string) => name === "get_public_products" ? { data: products, error: null } : outline };
    const catalog = await catalogModule(client, async () => curriculum).loadPublicCourseCatalog();
    assert.equal(catalog.length, 3);
    for (const item of catalog) {
      assert.equal(item.marketingCurriculum, curriculum);
      assert.equal(item.classroomCourse, null);
      assert.equal(item.contentReady, false);
      assert.equal(item.course.sections.length, 0);
    }
  }
});

test("owned course lookup never calls marketing loader and retains classroom lesson IDs", async () => {
  const row = {
    product_id: "product-id", product_slug: "sns-monetization", product_title: "베이직", product_summary: "소개", product_price_krw: 930000,
    product_access_period_days: 365, product_thumbnail_path: null, product_detail_path: null,
    course_slug: "sns-monetization", course_title: "학습 강의", course_short_title: "학습", course_description: "학습 설명", course_instructor: "이윰", course_poster_path: null,
    section_id: "section-id", section_key: "actual-section", section_title: "실제 챕터", section_description: "", lesson_key: "actual-lesson-id", lesson_title: "실제 강의 제목", lesson_duration_seconds: 90,
  };
  const catalogLoader = catalogModule(null, async () => { throw new Error("Marketing unavailable"); });
  const item = await catalogLoader.loadMyCourseBySlug({ rpc: async () => ({ data: [row], error: null }) }, "sns-monetization");
  assert.ok(item);
  assert.equal(item.classroomCourse?.sections[0].lessons[0].id, "actual-lesson-id");
  assert.equal(item.classroomCourse?.sections[0].lessons[0].title, "실제 강의 제목");
  assert.equal(item.marketingCurriculum, undefined);
});

test("marketing query rejection is contained and does not fabricate writable seed data", async () => {
  const marketingLoader = loadModule<{
    loadMarketingCurriculumResult: (client: unknown) => Promise<curriculumTypes.MarketingCurriculumLoadResult>;
  }>("src/lib/store/marketing-curriculum.ts", {
    "server-only": {}, react: { cache: (callback: unknown) => callback }, "@/lib/supabase/public": {},
    "./marketing-curriculum-seed": { snsMarketingCurriculumSeed }, "./marketing-curriculum-data": curriculumData, "./marketing-curriculum-types": curriculumTypes,
  });
  const result = await marketingLoader.loadMarketingCurriculumResult({ from: () => { throw new Error("network failure"); } });
  assert.equal(result.editable, false);
  assert.equal(result.curriculum.chapters.length, 0);
});

test("public sale facts derive marketing counts even when all real lessons are gone", async () => {
  const catalog = await catalogModule({ rpc: async (name: string) => ({ data: name === "get_public_products" ? [{ id: "product", slug: "sns-monetization", title: "베이직", summary: "소개", price_krw: 930000, list_price_krw: null, status: "active", access_period_days: 365, thumbnail_path: null, detail_path: null, product_type: "course" }] : [], error: null }) }, async () => curriculum).loadPublicCourseCatalog();
  const saleLoader = loadModule<{ loadPublicSaleDetail: (slug: string) => Promise<SaleDetail> }>("src/lib/store/public-sale.ts", {
    "server-only": {}, react: { cache: (callback: unknown) => callback }, "@/lib/store/consulting-copy": {}, "@/lib/store/product-pages": {}, "@/lib/store/public-detail-items": {},
    "@/lib/store/membership-plans": membershipPlans, "@/lib/store/marketing-curriculum-types": curriculumTypes, "@/lib/store/marketing-curriculum": {},
    "@/lib/store/public-course-catalog": { loadPublicCourseBySlug: async () => catalog[0] }, "@/lib/store/public-products": {},
  });
  const detail = await saleLoader.loadPublicSaleDetail("sns-monetization");
  assert.equal(detail.facts.find((fact) => fact.label === "커리큘럼")?.value, "10개 챕터 · 89강");
  assert.equal(detail.facts.find((fact) => fact.label === "총 재생 시간")?.value, "안내 예정");
  assert.ok(detail.metaItems.includes("89강"));
});

test("SNS sale detail retains marketing curriculum when every membership product is unpublished", async () => {
  const saleLoader = loadModule<{ loadPublicSaleDetail: (slug: string) => Promise<SaleDetail> }>("src/lib/store/public-sale.ts", {
    "server-only": {}, react: { cache: (callback: unknown) => callback }, "@/lib/store/consulting-copy": {}, "@/lib/store/product-pages": {}, "@/lib/store/public-detail-items": {},
    "@/lib/store/membership-plans": membershipPlans, "@/lib/store/marketing-curriculum-types": curriculumTypes,
    "@/lib/store/marketing-curriculum": { loadPublicMarketingCurriculum: async () => curriculum },
    "@/lib/store/public-course-catalog": { loadPublicCourseBySlug: async () => null },
    "@/lib/store/public-products": { loadPublicProductBySlug: () => { throw new Error("Marketing requires no published product"); } },
  });
  for (const plan of membershipPlans.membershipPlanDefinitions) {
    const detail = await saleLoader.loadPublicSaleDetail(plan.slug);
    assert.equal(detail.marketingCurriculum, curriculum);
    assert.equal(detail.course, null);
    assert.equal(detail.ctaHref, null);
    assert.equal(detail.facts.find((fact) => fact.label === "커리큘럼")?.value, "10개 챕터 · 89강");
  }
});

test("homepage and sale detail render marketing item copy with semantic assignment labels", () => {
  const home = readSource("src/app/page.tsx");
  const detail = readSource("src/components/store/SaleDetailPage.tsx");
  assert.match(home, /loadPublicMarketingCurriculum/);
  assert.match(home, /countMarketingLessons/);
  assert.doesNotMatch(home, /landingLessonTitleOverrides/);
  for (const source of [home, detail]) {
    assert.match(source, /item\.title/);
    assert.match(source, /item\.lessonNumber/);
    assert.match(source, /item\.kind === "assignment"/);
    assert.match(source, /"과제"/);
  }
});

function actionHarness(access: unknown, result: { data: unknown; error: { code: string } | null }) {
  const calls: Array<{ name: string; payload: unknown }> = [];
  const paths: string[] = [];
  const actions = loadModule<{
    saveMarketingCurriculumAction: (input: unknown) => Promise<{ ok: boolean; code?: string; version?: number }>;
  }>("src/app/admin/curriculum/actions.ts", {
    "next/cache": { revalidatePath: (path: string) => paths.push(path) },
    "@/lib/admin/auth": { getAdminAccess: async () => access },
    "@/lib/supabase/server": { createClient: async () => ({ rpc: async (name: string, payload: unknown) => { calls.push({ name, payload }); return result; } }) },
    "@/lib/store/marketing-curriculum-types": curriculumTypes,
    "@/lib/store/marketing-curriculum-validation": curriculumValidation,
  });
  return { actions, calls, paths };
}

test("save action rejects unauthenticated and non-admin callers before RPC", async () => {
  for (const status of ["unauthenticated", "denied", "unavailable"]) {
    const harness = actionHarness({ status }, { data: 2, error: null });
    const result = await harness.actions.saveMarketingCurriculumAction({ key: "sns-monetization", expectedVersion: 1, chapters: draft() });
    assert.equal(result.code, "forbidden");
    assert.equal(harness.calls.length, 0);
    assert.equal(harness.paths.length, 0);
  }
});

test("save action validates curriculum key, version and payload before RPC", async () => {
  const harness = actionHarness({ status: "granted", admin: { role: "operator" } }, { data: 2, error: null });
  for (const input of [null, { key: "other", expectedVersion: 1, chapters: draft() }, { key: "sns-monetization", expectedVersion: 0, chapters: draft() }, { key: "sns-monetization", expectedVersion: 1, chapters: [] }]) {
    const result = await harness.actions.saveMarketingCurriculumAction(input);
    assert.equal(result.code, "invalid");
  }
  assert.equal(harness.calls.length, 0);
});

test("operator and owner saves send one normalized atomic RPC and revalidate public pages", async () => {
  for (const role of ["operator", "owner"]) {
    const harness = actionHarness({ status: "granted", admin: { role } }, { data: 8, error: null });
    const chapters = draft();
    chapters[0].title = "  새로운 공개 챕터  ";
    const result = await harness.actions.saveMarketingCurriculumAction({ key: "sns-monetization", expectedVersion: 7, chapters });
    assert.equal(result.ok, true);
    assert.equal(result.version, 8);
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.calls[0].name, "save_marketing_curriculum");
    const payload = harness.calls[0].payload as { target_key: string; expected_version: number; next_chapters: curriculumTypes.MarketingCurriculumChapter[] };
    assert.equal(payload.target_key, "sns-monetization");
    assert.equal(payload.expected_version, 7);
    assert.equal(payload.next_chapters[0].title, "새로운 공개 챕터");
    assert.deepEqual(harness.paths, ["/", "/courses", "/courses/[slug]", "/admin/curriculum"]);
  }
});

test("stale and missing migration saves return explicit failures without success revalidation", async () => {
  for (const [code, expected] of [["40001", "stale"], ["P0002", "unavailable"], ["PGRST202", "unavailable"], ["42501", "forbidden"], ["22023", "invalid"]]) {
    const harness = actionHarness({ status: "granted", admin: { role: "operator" } }, { data: null, error: { code } });
    const result = await harness.actions.saveMarketingCurriculumAction({ key: "sns-monetization", expectedVersion: 1, chapters: draft() });
    assert.equal(result.ok, false);
    assert.equal(result.code, expected);
    assert.equal(harness.paths.length, 0);
  }
});

function loadAdmin(overrides: Record<string, unknown> = {}) {
  const components = loadModule<{
    default: (props: { initialResult: curriculumTypes.MarketingCurriculumLoadResult }) => React.ReactElement;
  }>("src/components/admin/AdminMarketingCurriculumManager.tsx", {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: (props: React.ComponentProps<"a">) => React.createElement("a", props) },
    "@/app/admin/curriculum/actions": { saveMarketingCurriculumAction: () => { throw new Error("Rendering must never save"); } },
    "@/lib/store/marketing-curriculum-types": curriculumTypes,
    "@/lib/store/marketing-curriculum-validation": curriculumValidation,
    "./AdminFeedback": { useAdminFeedback: () => ({ toast: () => {}, confirm: async () => false }) },
    "./icons": { ArrowUpIcon: () => null, ArrowDownIcon: () => null, ChevronIcon: () => null, PlusIcon: () => null },
    "./AdminMarketingCurriculumManager.module.css": { default: {} },
    ...overrides,
  });
  return components.default;
}

function renderAdmin(initialResult: curriculumTypes.MarketingCurriculumLoadResult) {
  return renderToStaticMarkup(React.createElement(loadAdmin(), { initialResult }));
}

test("admin missing schema renders approved copy, assignment semantics and disables editing and saving", () => {
  const markup = renderAdmin(resolveMarketingCurriculumLoad(null, { code: "42P01" }, snsMarketingCurriculumSeed));
  assert.match(markup, /마이그레이션이 적용되지 않았습니다/);
  assert.match(markup, /<fieldset[^>]*disabled/);
  assert.match(markup, /<button[^>]*type="submit"[^>]*disabled/);
  assert.match(markup, /강의 번호|차시 번호/);
  assert.match(markup, /과제/);
  assert.match(markup, /카테고리 잘못 고르면 시작부터 불리합니다/);
  assert.equal((markup.match(/<summary>/g) ?? []).length, 10);
  assert.doesNotMatch(markup, /<details[^>]*open/);
});

test("admin persisted row enables accessible editing but save stays disabled until something changes", () => {
  const result = resolveMarketingCurriculumLoad({ curriculum_key: "sns-monetization", chapters: draft(), version: 3, updated_at: "2026-10-05T00:00:00Z" }, null, snsMarketingCurriculumSeed);
  const markup = renderAdmin(result);
  assert.doesNotMatch(markup, /<fieldset[^>]*disabled/);
  assert.match(markup, /<button[^>]*type="submit"[^>]*disabled/);
  assert.match(markup, /저장 버전 3/);
  assert.match(markup, /1번째 챕터 위로 이동/);
  assert.match(markup, /1번째 챕터 제목/);
  assert.match(markup, /최신 내용 다시 불러오기/);
  assert.equal((markup.match(/<summary>/g) ?? []).length, 10);
  assert.doesNotMatch(markup, /<details[^>]*open/);
});

type AdminTestElement = React.ReactElement<Record<string, unknown>>;

function adminElements(tree: unknown, type: string): AdminTestElement[] {
  if (Array.isArray(tree)) return tree.flatMap((child) => adminElements(child, type));
  if (!React.isValidElement<Record<string, unknown>>(tree)) return [];
  return [...(tree.type === type ? [tree] : []), ...adminElements(tree.props.children, type)];
}

function adminInteractionHarness() {
  const hooks: unknown[] = [];
  const saves: { chapters: curriculumTypes.MarketingCurriculumChapter[] }[] = [];
  let hookIndex = 0;
  let pending = Promise.resolve();
  const initialResult = resolveMarketingCurriculumLoad({ curriculum_key: "sns-monetization", chapters: draft(), version: 3, updated_at: "2026-10-05T00:00:00Z" }, null, snsMarketingCurriculumSeed);
  const Component = loadAdmin({
    react: {
      useState(initial: unknown) {
        const index = hookIndex++;
        if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
        return [hooks[index], (next: unknown) => {
          hooks[index] = typeof next === "function" ? next(hooks[index]) : next;
        }];
      },
      useRef(initial: unknown) {
        const index = hookIndex++;
        if (!(index in hooks)) hooks[index] = { current: initial };
        return hooks[index];
      },
      useMemo: (calculate: () => unknown) => calculate(),
      useEffect: () => {},
      useTransition: () => [false, (action: () => Promise<void>) => { pending = action(); }],
    },
    "@/app/admin/curriculum/actions": { saveMarketingCurriculumAction: async (input: typeof saves[number]) => {
      saves.push(input);
      return { ok: true, version: 4, chapters: input.chapters };
    } },
  });
  function elements(type: string) {
    hookIndex = 0;
    return adminElements(Component({ initialResult }), type);
  }
  function toggle(index: number, open: boolean) {
    const onToggle = elements("details")[index].props.onToggle as (event: unknown) => void;
    onToggle({ currentTarget: { open } });
  }
  return { elements, toggle, saves, saved: () => pending };
}

test("chapter toggles preserve drafts and whole-curriculum saves even when all chapters are closed", async () => {
  const harness = adminInteractionHarness();
  const firstItem = snsMarketingCurriculumSeed[0].items[0];
  assert.ok(harness.elements("details").every((element) => element.props.open === false));
  harness.toggle(0, true);
  assert.equal(harness.elements("details")[0].props.open, true);
  assert.equal(harness.elements("button").find((element) => element.props.type === "submit")?.props.disabled, true);

  const itemInput = harness.elements("input").find((element) => element.props.id === `item-title-${firstItem.key}`);
  assert.ok(itemInput);
  (itemInput.props.onChange as (event: unknown) => void)({ target: { value: "수정한 제목" } });
  harness.toggle(0, false);
  harness.toggle(0, true);
  assert.equal(harness.elements("input").find((element) => element.props.id === `item-title-${firstItem.key}`)?.props.value, "수정한 제목");
  harness.toggle(0, false);
  (harness.elements("form")[0].props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
  await harness.saved();
  assert.equal(harness.saves.length, 1);
  assert.equal(harness.saves[0].chapters.length, 10);
  assert.equal(harness.saves[0].chapters.flatMap((chapter) => chapter.items).length, 102);
  assert.equal(countMarketingLessons(harness.saves[0].chapters), 89);
  assert.equal(harness.saves[0].chapters[0].items[0].title, "수정한 제목");
  assert.ok(harness.elements("details").every((element) => element.props.open === false));
});

test("chapter expansion follows stable keys on reorder and new chapters open automatically", () => {
  const harness = adminInteractionHarness();
  harness.toggle(0, true);
  const moveButton = harness.elements("button").find((element) => element.props["aria-label"] === "1번째 챕터 아래로 이동");
  assert.ok(moveButton);
  (moveButton.props.onClick as () => void)();
  assert.equal(harness.elements("details")[0].props.open, false);
  assert.equal(harness.elements("details")[1].props.open, true);
  const addButton = harness.elements("button").find((element) => (element.props.children as unknown[])?.includes("챕터 추가"));
  assert.ok(addButton);
  (addButton.props.onClick as () => void)();
  const details = harness.elements("details");
  assert.equal(details.length, 11);
  assert.equal(details[10].props.open, true);
  assert.equal(details[1].props.open, true);
});
