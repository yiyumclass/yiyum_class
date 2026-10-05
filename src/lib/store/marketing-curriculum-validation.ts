import {
  MAX_MARKETING_CHAPTERS,
  MAX_MARKETING_ITEMS,
  MAX_MARKETING_ITEMS_PER_CHAPTER,
  type MarketingCurriculumChapter,
  type MarketingCurriculumItem,
} from "./marketing-curriculum-types.ts";

type ValidationResult =
  | { ok: true; chapters: MarketingCurriculumChapter[] }
  | { ok: false; message: string };

const keyPattern = /^[a-z0-9][a-z0-9_-]{0,79}$/;

export function validateMarketingCurriculum(input: unknown): ValidationResult {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_MARKETING_CHAPTERS) {
    return { ok: false, message: `챕터는 1개부터 ${MAX_MARKETING_CHAPTERS}개까지 등록할 수 있습니다.` };
  }

  const chapterKeys = new Set<string>();
  const itemKeys = new Set<string>();
  const lessonNumbers = new Set<number>();
  const chapters: MarketingCurriculumChapter[] = [];
  let itemCount = 0;

  for (const [chapterIndex, value] of input.entries()) {
    const label = `${chapterIndex + 1}번 챕터`;
    if (!isRecord(value) || !hasExactKeys(value, ["key", "title", "items"])) {
      return { ok: false, message: `${label} 형식을 확인해 주세요.` };
    }
    if (!isKey(value.key) || chapterKeys.has(value.key)) {
      return { ok: false, message: `${label} 식별자가 올바르지 않거나 중복되었습니다.` };
    }
    if (!isTitle(value.title)) {
      return { ok: false, message: `${label} 제목은 공백을 제외한 1~200자로 입력해 주세요.` };
    }
    if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > MAX_MARKETING_ITEMS_PER_CHAPTER) {
      return { ok: false, message: `${label}에는 항목을 1~${MAX_MARKETING_ITEMS_PER_CHAPTER}개 등록해 주세요.` };
    }
    chapterKeys.add(value.key);
    itemCount += value.items.length;
    if (itemCount > MAX_MARKETING_ITEMS) {
      return { ok: false, message: `전체 항목은 ${MAX_MARKETING_ITEMS}개까지 등록할 수 있습니다.` };
    }
    const items: MarketingCurriculumItem[] = [];
    for (const [itemIndex, item] of value.items.entries()) {
      const itemLabel = `${label}의 ${itemIndex + 1}번 항목`;
      if (!isRecord(item) || !hasExactKeys(item, ["key", "title", "lessonNumber", "kind"])) {
        return { ok: false, message: `${itemLabel} 형식을 확인해 주세요.` };
      }
      if (!isKey(item.key) || itemKeys.has(item.key)) {
        return { ok: false, message: `${itemLabel} 식별자가 올바르지 않거나 중복되었습니다.` };
      }
      if (!isTitle(item.title)) {
        return { ok: false, message: `${itemLabel} 제목은 공백을 제외한 1~200자로 입력해 주세요.` };
      }
      if (item.kind !== "lesson" && item.kind !== "assignment") {
        return { ok: false, message: `${itemLabel} 유형을 강의 또는 과제로 선택해 주세요.` };
      }
      const lessonNumber = item.lessonNumber;
      if (lessonNumber === null) {
        if (item.kind === "lesson") {
          return { ok: false, message: `${itemLabel} 강의 번호를 입력해 주세요.` };
        }
      } else if (typeof lessonNumber !== "number" || !Number.isInteger(lessonNumber) || lessonNumber < 1 || lessonNumber > 999 || lessonNumbers.has(lessonNumber)) {
        return { ok: false, message: `${itemLabel} 강의 번호는 중복되지 않는 1~999의 정수로 입력해 주세요.` };
      }
      itemKeys.add(item.key);
      if (lessonNumber !== null) lessonNumbers.add(lessonNumber);
      items.push({ key: item.key, title: item.title.trim(), lessonNumber, kind: item.kind });
    }
    chapters.push({ key: value.key, title: value.title.trim(), items });
  }
  return { ok: true, chapters };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isKey(value: unknown): value is string {
  return typeof value === "string" && keyPattern.test(value);
}

function isTitle(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Array.from(value.trim()).length <= 200;
}
