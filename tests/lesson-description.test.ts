import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyCourseLessonDescriptions,
  isLessonDescriptionSchemaMissing,
  MAX_LESSON_DESCRIPTION_LENGTH,
  parseLessonDescription,
  validateLessonDescription,
} from "../src/lib/learning/lesson-description.ts";
import type { Course } from "../src/lib/learning/types.ts";

test("lesson descriptions preserve paragraphs, line breaks and tripod sales links", () => {
  const paragraphs = parseLessonDescription(
    "삼각대 높이를 맞춰 주세요.\r\n휴대폰을 고정하세요.\r\n\r\n구매 링크: https://shop.example.com/tripod?color=black&size=2."
  );
  assert.deepEqual(paragraphs, [
    [{ type: "text", text: "삼각대 높이를 맞춰 주세요.\n휴대폰을 고정하세요." }],
    [
      { type: "text", text: "구매 링크: " },
      {
        type: "link",
        text: "https://shop.example.com/tripod?color=black&size=2",
        href: "https://shop.example.com/tripod?color=black&size=2",
      },
      { type: "text", text: "." },
    ],
  ]);
});

test("only valid http and https URLs become links", () => {
  const description = "http://example.com/a HTTPS://example.com/b javascript:alert(1) data:text/html,x ftp://example.com //example.com javascript:https://example.com https://user:password@example.com https:// https://%00.example.com https://good.example\\@bad.example";
  const parts = parseLessonDescription(description).flat();
  assert.deepEqual(parts.filter((part) => part.type === "link").map((part) => part.href), [
    "http://example.com/a", "https://example.com/b",
  ]);
  assert.equal(parts.map((part) => part.text).join(""), description);
});

test("URL boundaries preserve balanced parentheses and trim surrounding punctuation", () => {
  const parts = parseLessonDescription("(https://example.com/a_(b)), https://example.com/b! https://example.com/c。 ").flat();
  assert.deepEqual(parts.filter((part) => part.type === "link").map((part) => part.text), [
    "https://example.com/a_(b)", "https://example.com/b", "https://example.com/c",
  ]);
  assert.equal(parts.map((part) => part.text).join(""), "(https://example.com/a_(b)), https://example.com/b! https://example.com/c。");
});

test("HTML and unsupported protocols remain ordinary text", () => {
  const description = '<script>alert(1)</script> <img src=x onerror=alert(1)> <a href="javascript:alert(1)">구매</a>';
  assert.deepEqual(parseLessonDescription(description), [[{ type: "text", text: description }]]);
  assert.deepEqual(parseLessonDescription(" \r\n\n "), []);
});

test("URLs with invisible direction controls remain text", () => {
  for (const control of ["\u200b", "\u202e", "\u2066", "\u0001"]) {
    const description = `https://example.com/${control}tripod`;
    assert.deepEqual(parseLessonDescription(description), [[{ type: "text", text: description }]]);
  }
});

test("description validation normalizes text, allows clearing, and bounds length", () => {
  assert.deepEqual(validateLessonDescription("  첫 줄\r\n둘째 줄\r\n\r\n문단  "), {
    valid: true, description: "첫 줄\n둘째 줄\n\n문단",
  });
  assert.deepEqual(validateLessonDescription(" \n "), { valid: true, description: "" });
  assert.equal(validateLessonDescription("가".repeat(MAX_LESSON_DESCRIPTION_LENGTH)).valid, true);
  assert.equal(validateLessonDescription("가".repeat(MAX_LESSON_DESCRIPTION_LENGTH + 1)).valid, false);
  for (const value of [null, undefined, 1, {}, "invalid\0text", new Blob(["file"])]) {
    assert.equal(validateLessonDescription(value).valid, false);
  }
});

test("description hydration matches section and lesson keys without changing classroom identity or playback", () => {
  const course: Course = {
    slug: "original-course",
    title: "강의",
    shortTitle: "강의",
    description: "강의 소개",
    instructor: "이윰",
    posterSrc: "/poster.jpg",
    sections: ["chapter-1", "chapter-2"].map((id) => ({
      id, title: id, description: "챕터 소개",
      lessons: [
        { id: "existing-lesson-key", title: "촬영", durationSeconds: 528, videoSrc: "/api/learning/video/original-course/existing-lesson-key", availability: "available" },
        { id: "locked-lesson-key", title: "예정", durationSeconds: 30, availability: "coming-soon" },
      ],
    })),
  };
  const snapshot = structuredClone(course);
  const hydrated = applyCourseLessonDescriptions(course, [
    { section_key: "chapter-1", lesson_key: "existing-lesson-key", description: "삼각대 안내" },
    { section_key: "chapter-2", lesson_key: "existing-lesson-key", description: "다른 설명" },
    { section_key: "other-chapter", lesson_key: "existing-lesson-key", description: "유출되지 않음" },
  ]);
  assert.equal(hydrated.slug, "original-course");
  assert.equal(hydrated.sections[0].lessons[0].description, "삼각대 안내");
  assert.equal(hydrated.sections[1].lessons[0].description, "다른 설명");
  assert.equal(hydrated.sections[0].lessons[1].description, "");
  const withoutDescriptions = {
    ...hydrated,
    sections: hydrated.sections.map((section) => ({
      ...section,
      lessons: section.lessons.map(({ description, ...lesson }) => {
        assert.equal(typeof description, "string");
        return lesson;
      }),
    })),
  };
  assert.deepEqual(withoutDescriptions, course);
  assert.deepEqual(course, snapshot);
});

test("missing description schemas are identified separately from permissions and transport errors", () => {
  for (const code of ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"]) {
    assert.equal(isLessonDescriptionSchemaMissing(code), true);
  }
  for (const code of [undefined, "42501", "PGRST301", "08006"]) {
    assert.equal(isLessonDescriptionSchemaMissing(code), false);
  }
});

test("description schema protects content separately from the public lesson outline", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20261005100000_add_lesson_descriptions.sql", import.meta.url), "utf8");
  assert.match(migration, /lesson_id uuid primary key references public\.lessons\(id\) on delete cascade/);
  assert.match(migration, /check \(char_length\(description\) <= 10000\)/);
  assert.match(migration, /alter table public\.lesson_descriptions enable row level security/);
  assert.match(migration, /revoke all on table public\.lesson_descriptions from public, anon, authenticated/);
  assert.match(migration, /entitlement\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /entitlement\.status = 'active'/);
  assert.match(migration, /entitlement\.expires_at > now\(\)/);
  assert.match(migration, /scope\.access_mode = 'full'/);
  assert.match(migration, /chosen\.section_id = section\.id/);
  for (const name of ["lesson", "section", "course"]) {
    assert.match(migration, new RegExp(`${name}\\.status = 'published'`));
  }
  assert.match(migration, /using \(public\.is_admin\(\)\) with check \(public\.is_admin\(\)\)/);
  assert.match(migration, /course\.slug = target_course_slug\s+and public\.can_read_lesson_description\(lesson\.id\)/);
  assert.match(migration, /revoke all on function public\.get_course_lesson_descriptions\(text\) from public, anon, authenticated/);
  assert.doesNotMatch(migration, /alter table public\.lessons|create or replace function public\.get_course_video_manifest/i);
});

test("description changes audit their actor and before/after text in the same transaction", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20261005100000_add_lesson_descriptions.sql", import.meta.url), "utf8");
  assert.match(migration, /actor_id uuid := \(select auth\.uid\(\)\)/);
  assert.match(migration, /insert into public\.admin_audit_logs/);
  assert.match(migration, /'lessons\.description_updated', 'lessons', new\.lesson_id::text/);
  assert.match(migration, /'before', jsonb_build_object\('description', case when tg_op = 'UPDATE' then old\.description else '' end\)/);
  assert.match(migration, /'after', jsonb_build_object\('description', new\.description\)/);
  assert.match(migration, /after insert or update on public\.lesson_descriptions\s+for each row execute function public\.log_lesson_description_admin_change\(\)/);
  assert.match(migration, /revoke all on function public\.log_lesson_description_admin_change\(\) from public, anon, authenticated/);
});

test("description display uses escaped React text and protected external anchors", () => {
  const component = readFileSync(new URL("../src/components/learning/LessonDescription.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(component, /dangerouslySetInnerHTML|innerHTML/);
  assert.match(component, /href=\{part\.href\} target="_blank" rel="noopener noreferrer"/);
  assert.match(component, /\{part\.text\}/);
});
