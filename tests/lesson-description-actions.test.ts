import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";
import * as descriptionUtilities from "../src/lib/learning/lesson-description.ts";
import { isSafeLocalPath, isUuid } from "../src/lib/validation/safe-input.ts";

const lessonId = "00000000-0000-4000-8000-000000000001";
const adminId = "00000000-0000-4000-8000-000000000002";
const initialUpdatedAt = "2026-10-05T10:00:00.000000Z";
const staleUpdatedAt = "2026-10-05T09:00:00.000000Z";
const previousState = { status: "idle", message: "", fieldErrors: {} };

function loadLocalModule(path: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX },
  });
  const exports: Record<string, unknown> = {};
  const requireDependency = (name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  };
  new Function("require", "exports", compiled.outputText)(requireDependency, exports);
  return exports;
}

function createActionHarness({
  authorize = true,
  lessonExists = true,
  saveError = null,
  storedDescription = "",
}: {
  authorize?: boolean;
  lessonExists?: boolean;
  saveError?: { code: string; message: string } | null;
  storedDescription?: string | null;
} = {}) {
  const tables: string[] = [];
  const savedRows: Array<{ lesson_id: string; description: string; updated_by: string }> = [];
  const insertAttempts: unknown[] = [];
  const filterQueries: Array<{ table: string; filters: Record<string, string> }> = [];
  const revalidatedPaths: unknown[] = [];
  let clientCount = 0;
  let currentDescription = storedDescription;
  let currentUpdatedAt = storedDescription === null ? null : initialUpdatedAt;
  let updateCount = 0;
  const supabase = {
    from(table: string) {
      tables.push(table);
      const filters: Record<string, string> = {};
      filterQueries.push({ table, filters });
      let operation: "update" | "insert" | null = null;
      let write: { description: string; updated_by: string } | null = null;
      const query = {
        select() { return query; },
        eq(column: string, value: string) {
          if (table === "lessons") {
            assert.equal(column, "id");
            assert.equal(value, lessonId);
          } else if (column === "lesson_id") {
            assert.equal(value, lessonId);
          } else {
            assert.equal(column, "updated_at");
          }
          filters[column] = value;
          return query;
        },
        update(row: { description: string; updated_by: string }) {
          assert.equal(table, "lesson_descriptions");
          operation = "update";
          write = row;
          return query;
        },
        insert(row: { lesson_id: string; description: string; updated_by: string }) {
          assert.equal(table, "lesson_descriptions");
          assert.equal(row.lesson_id, lessonId);
          insertAttempts.push(row);
          operation = "insert";
          write = row;
          return query;
        },
        async maybeSingle() {
          if (table === "lessons") return { data: lessonExists ? { id: lessonId } : null, error: null };
          if (saveError) return { data: null, error: saveError };
          assert.ok(write);
          if (operation === "update") {
            assert.equal(filters.lesson_id, lessonId);
            assert.equal(typeof filters.updated_at, "string");
            if (currentDescription === null || currentUpdatedAt !== filters.updated_at) {
              return { data: null, error: null };
            }
          } else {
            assert.equal(operation, "insert");
            if (currentDescription !== null) return { data: null, error: { code: "23505", message: "duplicate lesson" } };
          }
          currentDescription = write.description;
          updateCount += 1;
          currentUpdatedAt = `2026-10-05T10:00:00.${String(updateCount).padStart(6, "0")}Z`;
          savedRows.push({ lesson_id: lessonId, ...write });
          return { data: { lesson_id: lessonId, updated_at: currentUpdatedAt }, error: null };
        },
      };
      return query;
    },
  };
  const actionModule = loadLocalModule("../src/app/admin/courses/actions.ts", {
    "next/cache": { revalidatePath: (...args: unknown[]) => revalidatedPaths.push(args) },
    "@/lib/admin/auth": {
      async requireAdmin() {
        if (!authorize) throw new Error("Denied");
        return { userId: adminId };
      },
    },
    "@/lib/mux/client": { getMuxClient: () => { throw new Error("Unexpected video mutation"); } },
    "@/lib/learning/lesson-description": descriptionUtilities,
    "@/lib/supabase/server": { async createClient() { clientCount += 1; return supabase; } },
    "@/lib/validation/safe-input": { isUuid, isSafeLocalPath },
  });
  const action = actionModule.updateLessonDescriptionAction as (
    id: string, previous: unknown, formData: FormData
  ) => Promise<{ status: string; message: string; savedDescription?: string; savedDescriptionUpdatedAt?: string }>;
  return {
    action, tables, savedRows, revalidatedPaths, insertAttempts, filterQueries,
    clientCount: () => clientCount,
    currentDescription: () => currentDescription,
    currentUpdatedAt: () => currentUpdatedAt,
  };
}

function descriptionForm(description: string, expectedUpdatedAt: string | null = initialUpdatedAt) {
  const formData = new FormData();
  formData.set("description", description);
  formData.set("expectedUpdatedAt", expectedUpdatedAt ?? "");
  formData.set("expectedMissing", expectedUpdatedAt === null ? "true" : "false");
  return formData;
}

test("description action rejects non-admin callers before creating a database client", async () => {
  const harness = createActionHarness({ authorize: false });
  await assert.rejects(harness.action(lessonId, previousState, descriptionForm("설명")), /Denied/);
  assert.equal(harness.clientCount(), 0);
  assert.deepEqual(harness.savedRows, []);
});

test("description action validates target UUID and text before accessing the database", async () => {
  const harness = createActionHarness();
  assert.equal((await harness.action("catalog:lesson", previousState, descriptionForm("설명"))).status, "error");
  assert.equal((await harness.action(lessonId, previousState, new FormData())).status, "error");
  assert.equal((await harness.action(lessonId, previousState, descriptionForm("가".repeat(10_001)))).status, "error");
  assert.equal(harness.clientCount(), 0);
});

test("description action conditionally updates an existing real lesson and returns the saved text", async () => {
  const harness = createActionHarness();
  const result = await harness.action(lessonId, previousState, descriptionForm(" 첫 줄\r\n\r\nhttps://shop.example.com/tripod "));
  assert.equal(result.status, "success");
  assert.equal(result.savedDescription, "첫 줄\n\nhttps://shop.example.com/tripod");
  assert.equal(result.savedDescriptionUpdatedAt, harness.currentUpdatedAt());
  assert.deepEqual(harness.tables, ["lessons", "lesson_descriptions"]);
  assert.deepEqual(harness.savedRows, [{
    lesson_id: lessonId,
    description: "첫 줄\n\nhttps://shop.example.com/tripod",
    updated_by: adminId,
  }]);
  assert.deepEqual(harness.revalidatedPaths, [["/admin/courses"], ["/learn", "layout"]]);
  assert.deepEqual(harness.filterQueries[1], {
    table: "lesson_descriptions", filters: { lesson_id: lessonId, updated_at: initialUpdatedAt },
  });
  assert.deepEqual(harness.insertAttempts, []);
});

test("description action never writes a nonexistent lesson", async () => {
  const harness = createActionHarness({ lessonExists: false });
  assert.equal((await harness.action(lessonId, previousState, descriptionForm("설명"))).status, "error");
  assert.deepEqual(harness.savedRows, []);
  assert.deepEqual(harness.revalidatedPaths, []);
});

test("missing description migration returns an explicit error without video/title writes or success revalidation", async () => {
  const harness = createActionHarness({ saveError: { code: "PGRST205", message: "table missing" } });
  const result = await harness.action(lessonId, previousState, descriptionForm("설명"));
  assert.equal(result.status, "error");
  assert.match(result.message, /준비/);
  assert.deepEqual(harness.tables, ["lessons", "lesson_descriptions"]);
  assert.deepEqual(harness.revalidatedPaths, []);
});

test("description action allows clearing the previous text", async () => {
  const harness = createActionHarness({ storedDescription: "기존 설명" });
  assert.equal((await harness.action(lessonId, previousState, descriptionForm(" \n "))).status, "success");
  assert.deepEqual(harness.savedRows, [{ lesson_id: lessonId, description: "", updated_by: adminId }]);
});

test("description action rejects missing or invalid timestamps and inconsistent missing flags before database access", async () => {
  const harness = createActionHarness();
  const missing = descriptionForm("설명");
  missing.delete("expectedUpdatedAt");
  const invalid = descriptionForm("설명", "invalid\0text");
  const tooLong = descriptionForm("설명", "가".repeat(10_001));
  const badFlag = descriptionForm("설명");
  badFlag.set("expectedMissing", "unexpected");
  const inconsistent = descriptionForm("설명");
  inconsistent.set("expectedMissing", "true");
  const missingFlag = descriptionForm("설명");
  missingFlag.delete("expectedMissing");
  for (const form of [missing, invalid, tooLong, badFlag, inconsistent, missingFlag]) {
    assert.equal((await harness.action(lessonId, previousState, form)).status, "error");
  }
  assert.equal(harness.clientCount(), 0);
});

test("a stale description cannot overwrite another editor or insert over their existing row", async () => {
  for (const expected of [staleUpdatedAt, null]) {
    const harness = createActionHarness({ storedDescription: "다른 관리자가 저장한 설명" });
    const result = await harness.action(lessonId, previousState, descriptionForm("내 작성 내용", expected));
    assert.equal(result.status, "error");
    assert.match(result.message, /변경/);
    assert.equal(harness.currentDescription(), "다른 관리자가 저장한 설명");
    assert.deepEqual(harness.savedRows, []);
    assert.deepEqual(harness.revalidatedPaths, []);
    assert.equal(harness.insertAttempts.length, expected === null ? 1 : 0);
  }
});

test("description action inserts only when the editor loaded no existing row", async () => {
  const harness = createActionHarness({ storedDescription: null });
  const result = await harness.action(lessonId, previousState, descriptionForm("새 설명", null));
  assert.equal(result.status, "success");
  assert.equal(result.savedDescription, "새 설명");
  assert.equal(harness.insertAttempts.length, 1);
  assert.deepEqual(harness.tables, ["lessons", "lesson_descriptions"]);

  const staleHarness = createActionHarness({ storedDescription: null });
  assert.equal((await staleHarness.action(lessonId, previousState, descriptionForm("새 설명"))).status, "error");
  assert.deepEqual(staleHarness.insertAttempts, []);
});

test("two concurrent initial description saves preserve the winning insert and reject the loser", async () => {
  const harness = createActionHarness({ storedDescription: null });
  const results = await Promise.all([
    harness.action(lessonId, previousState, descriptionForm("첫 번째 관리자", null)),
    harness.action(lessonId, previousState, descriptionForm("두 번째 관리자", null)),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["error", "success"]);
  assert.equal(harness.savedRows.length, 1);
  assert.equal(harness.currentDescription(), results.find((result) => result.status === "success")?.savedDescription);
  assert.equal(harness.revalidatedPaths.length, 2);
});

test("10k Korean descriptions stay in the request body and CAS URL filters contain only a small timestamp", async () => {
  const harness = createActionHarness({ storedDescription: "가".repeat(10_000) });
  assert.equal((await harness.action(lessonId, previousState, descriptionForm("나".repeat(10_000)))).status, "success");
  assert.equal(harness.filterQueries[1].filters.updated_at, initialUpdatedAt);
  assert.equal(Object.hasOwn(harness.filterQueries[1].filters, "description"), false);
  assert.ok(Object.values(harness.filterQueries[1].filters).every((value) => value.length < 50));
});

test("repeated saves advance the timestamp token and reject an already used version", async () => {
  const harness = createActionHarness({ storedDescription: "기존 설명" });
  const first = await harness.action(lessonId, previousState, descriptionForm("첫 번째 저장"));
  assert.equal(first.status, "success");
  assert.ok(first.savedDescriptionUpdatedAt);
  assert.equal((await harness.action(lessonId, previousState, descriptionForm("두 번째 저장", first.savedDescriptionUpdatedAt))).status, "success");
  assert.equal((await harness.action(lessonId, previousState, descriptionForm("오래된 수정"))).status, "error");
  assert.equal(harness.currentDescription(), "두 번째 저장");
  assert.equal(harness.savedRows.length, 2);
});

test("description component renders HTML as escaped text, paragraphs and safe links", () => {
  const require = createRequire(import.meta.url);
  const componentModule = loadLocalModule("../src/components/learning/LessonDescription.tsx", {
    "@/lib/learning/lesson-description": descriptionUtilities,
    "react/jsx-runtime": require("react/jsx-runtime"),
  });
  const Component = componentModule.default as ComponentType<{ description?: string }>;
  const html = renderToStaticMarkup(createElement(Component, {
    description: '<script>alert(1)</script>\n둘째 줄\n\nhttps://shop.example.com/tripod?x=1&y=2 javascript:alert(1)',
  }));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|href="javascript:/);
  assert.equal((html.match(/<p>/g) ?? []).length, 2);
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.match(html, /href="https:\/\/shop\.example\.com\/tripod\?x=1&amp;y=2" target="_blank" rel="noopener noreferrer"/);
  assert.equal(renderToStaticMarkup(createElement(Component, { description: " \n " })), "");
});

test("description loading leaves the classroom playable when its RPC migration is missing", async () => {
  const course = {
    slug: "original-course",
    sections: [{ id: "chapter-1", lessons: [{ id: "real-key", videoSrc: "/api/learning/video/original-course/real-key" }] }],
  };
  const descriptionModule = loadLocalModule("../src/lib/learning/lesson-descriptions.ts", {
    "server-only": {},
    "@/lib/learning/lesson-description": descriptionUtilities,
  });
  const hydrate = descriptionModule.hydrateCourseLessonDescriptions as (supabase: unknown, course: unknown) => Promise<unknown>;
  const supabase = {
    async rpc(name: string, args: unknown) {
      assert.equal(name, "get_course_lesson_descriptions");
      assert.deepEqual(args, { target_course_slug: "original-course" });
      return { data: null, error: { code: "PGRST202", message: "function missing" } };
    },
  };
  assert.equal(await hydrate(supabase, course), course);
});

test("admin course loading keeps title and video controls available before the description migration", async () => {
  const fixtures: Record<string, unknown[]> = {
    products: [{ id: "product-id", slug: "course", title: "판매 강의", status: "active" }],
    courses: [{
      id: "course-id", product_id: "product-id", slug: "course", title: "강의",
      short_title: "강의", description: "강의 소개", instructor: "이윰", poster_path: "/poster.jpg",
      status: "published", updated_at: "2026-10-05",
    }],
    course_sections: [{
      id: "section-id", course_id: "course-id", section_key: "chapter-1", title: "챕터",
      description: "챕터 소개", status: "published", sort_order: 1, updated_at: "2026-10-05",
    }],
    lessons: [{
      id: lessonId, section_id: "section-id", lesson_key: "existing-key", title: "삼각대",
      duration_seconds: 528, mux_status: "ready", mux_playback_id: "existing-playback",
      status: "published", is_preview: false, sort_order: 1, updated_at: "2026-10-05",
    }],
    product_course_scopes: [],
  };
  const supabase = {
    from(table: string) {
      const query = {
        select() { return query; },
        eq() { return query; },
        in() { return query; },
        order() { return query; },
        async returns() {
          return table === "lesson_descriptions"
            ? { data: null, error: { code: "PGRST205", message: "table missing" } }
            : { data: fixtures[table], error: null };
        },
      };
      return query;
    },
  };
  const adminModule = loadLocalModule("../src/lib/admin/courses.ts", {
    "server-only": {},
    "@/lib/admin/auth": { async requireAdmin() { return { userId: adminId }; } },
    "@/lib/learning/catalog": { courses: [] },
    "@/lib/learning/lesson-description": descriptionUtilities,
    "@/lib/runtime/catalog-fallback": {
      canUseLocalCatalogFallback: () => false,
      logProductionCatalogFallbackBlocked: () => assert.fail("Existing catalog should remain available"),
    },
    "@/lib/store/course-products": { courseProducts: [] },
    "@/lib/supabase/server": { async createClient() { return supabase; } },
  });
  const load = adminModule.loadAdminCourses as () => Promise<{
    databaseReady: boolean;
    videoStorageReady: boolean;
    courses: Array<{ source: string; sections: Array<{ lessons: Array<{
      id: string; title: string; hasVideo: boolean; descriptionEditable: boolean;
    }> }> }>;
  }>;
  const result = await load();
  assert.equal(result.databaseReady, true);
  assert.equal(result.videoStorageReady, true);
  assert.equal(result.courses[0].source, "database");
  assert.equal(result.courses[0].sections[0].lessons[0].id, lessonId);
  assert.equal(result.courses[0].sections[0].lessons[0].title, "삼각대");
  assert.equal(result.courses[0].sections[0].lessons[0].hasVideo, true);
  assert.equal(result.courses[0].sections[0].lessons[0].descriptionEditable, false);
});
