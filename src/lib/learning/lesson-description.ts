import type { Course } from "./types";

export const MAX_LESSON_DESCRIPTION_LENGTH = 10_000;

export type LessonDescriptionPart =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string };

export type LessonDescriptionRow = {
  section_key: string;
  lesson_key: string;
  description: string;
};

export function applyCourseLessonDescriptions(course: Course, rows: LessonDescriptionRow[]): Course {
  const descriptionsBySection = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const descriptions = descriptionsBySection.get(row.section_key) ?? new Map<string, string>();
    descriptions.set(row.lesson_key, row.description);
    descriptionsBySection.set(row.section_key, descriptions);
  }

  return {
    ...course,
    sections: course.sections.map((section) => ({
      ...section,
      lessons: section.lessons.map((lesson) => ({
        ...lesson,
        description: descriptionsBySection.get(section.id)?.get(lesson.id) ?? "",
      })),
    })),
  };
}

export function validateLessonDescription(value: unknown):
  | { valid: true; description: string }
  | { valid: false; message: string } {
  if (typeof value !== "string" || value.includes("\0")) {
    return { valid: false, message: "영상 설명을 일반 텍스트로 입력해 주세요." };
  }
  const description = value.replace(/\r\n?/g, "\n").trim();
  if (description.length > MAX_LESSON_DESCRIPTION_LENGTH) {
    return { valid: false, message: "영상 설명은 10,000자 이하로 입력해 주세요." };
  }
  return { valid: true, description };
}

export function isLessonDescriptionSchemaMissing(code: string | undefined) {
  return ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(code ?? "");
}

export function parseLessonDescription(description: string): LessonDescriptionPart[][] {
  return description.replace(/\r\n?/g, "\n").trim().split(/\n[\t ]*\n+/)
    .filter((paragraph) => paragraph.trim())
    .map(linkifyParagraph);
}

function linkifyParagraph(paragraph: string): LessonDescriptionPart[] {
  const parts: LessonDescriptionPart[] = [];
  const pattern = /https?:\/\/[^\s<>"'`]+/gi;
  let position = 0;

  for (const match of paragraph.matchAll(pattern)) {
    const start = match.index;
    if (start > 0 && /[\p{L}\p{N}_/:@]/u.test(paragraph[start - 1])) continue;
    const candidate = trimUrlPunctuation(match[0]);
    const href = safeHttpUrl(candidate);
    if (!href) continue;

    if (start > position) parts.push({ type: "text", text: paragraph.slice(position, start) });
    parts.push({ type: "link", text: candidate, href });
    position = start + candidate.length;
  }

  if (position < paragraph.length) parts.push({ type: "text", text: paragraph.slice(position) });
  return parts;
}

function trimUrlPunctuation(value: string) {
  let candidate = value.replace(/[.,!?;:。！，？、]+$/u, "");
  const pairs = [["(", ")"], ["[", "]"], ["{", "}"]];
  let previous: string;
  do {
    previous = candidate;
    for (const [opening, closing] of pairs) {
      if (candidate.endsWith(closing) &&
          candidate.split(closing).length > candidate.split(opening).length) {
        candidate = candidate.slice(0, -1).replace(/[.,!?;:。！，？、]+$/u, "");
      }
    }
  } while (candidate !== previous);
  return candidate;
}

function safeHttpUrl(value: string): string | null {
  if (/[\\\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
