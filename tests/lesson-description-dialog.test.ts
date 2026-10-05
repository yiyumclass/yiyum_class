import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";
import type { CourseFormState } from "../src/app/admin/courses/actions.ts";
import type { AdminLesson } from "../src/lib/admin/courses.ts";

const initialUpdatedAt = "2026-10-05T10:00:00.000000Z";
const savedUpdatedAt = "2026-10-05T10:00:00.000001Z";

type TestElement = { type: unknown; props: Record<string, unknown> };

function findElement(tree: unknown, type: unknown): TestElement | undefined {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = findElement(child, type);
      if (found) return found;
    }
  } else if (tree && typeof tree === "object" && "props" in tree) {
    const element = tree as TestElement;
    if (element.type === type) return element;
    return findElement(element.props.children, type);
  }
}

function createDialogHarness({
  save,
  descriptionEditable = true,
  descriptionUpdatedAt = initialUpdatedAt,
}: {
  save?: (formData: FormData) => Promise<CourseFormState>;
  descriptionEditable?: boolean;
  descriptionUpdatedAt?: string | null;
} = {}) {
  const hookValues: unknown[] = [];
  let hookIndex = 0;
  let closeCount = 0;
  let confirmResult = false;
  const confirmCalls: unknown[] = [];
  const saveCalls: FormData[] = [];
  const lesson: AdminLesson = {
    id: "00000000-0000-4000-8000-000000000001", key: "existing-key", title: "삼각대",
    description: "기존 설명", descriptionEditable, descriptionUpdatedAt,
    durationSeconds: 528, hasVideo: true, videoStatus: "ready", status: "published",
    isPreview: false, sortOrder: 1, updatedAt: initialUpdatedAt,
  };
  const reactHooks = {
    useState(initial: unknown) {
      const index = hookIndex++;
      if (!(index in hookValues)) hookValues[index] = initial;
      return [hookValues[index], (next: unknown) => {
        hookValues[index] = typeof next === "function" ? next(hookValues[index]) : next;
      }];
    },
    useRef(initial: unknown) {
      const index = hookIndex++;
      if (!(index in hookValues)) hookValues[index] = { current: initial };
      return hookValues[index];
    },
    useEffect() { hookIndex += 1; },
    useActionState(action: (previous: CourseFormState, formData: FormData) => Promise<CourseFormState>, initial: CourseFormState) {
      const index = hookIndex++;
      if (!(index in hookValues)) hookValues[index] = { state: initial, pending: false };
      const hook = hookValues[index] as { state: CourseFormState; pending: boolean };
      return [hook.state, async (formData: FormData) => {
        hook.pending = true;
        try {
          hook.state = await action(hook.state, formData);
          return hook.state;
        } finally {
          hook.pending = false;
        }
      }, hook.pending];
    },
  };
  const require = createRequire(import.meta.url);
  const dependencies: Record<string, unknown> = {
    react: reactHooks,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@/app/admin/courses/actions": {
      async updateLessonDescriptionAction(id: string, previous: CourseFormState, formData: FormData) {
        assert.equal(id, lesson.id);
        assert.ok(previous);
        saveCalls.push(formData);
        return save ? save(formData) : {
          status: "success", message: "저장했습니다.", fieldErrors: {},
          savedDescription: String(formData.get("description")).trim(),
          savedDescriptionUpdatedAt: savedUpdatedAt,
        };
      },
    },
    "@/lib/learning/lesson-description": { MAX_LESSON_DESCRIPTION_LENGTH: 10_000 },
    "./AdminDialog": { default: "admin-dialog", AdminDialogActions: "dialog-actions" },
    "./AdminFeedback": { useAdminFeedback: () => ({
      async confirm(options: unknown) { confirmCalls.push(options); return confirmResult; },
    }) },
    "./AdminCourseManager.module.css": { default: {} },
  };
  const source = readFileSync(new URL("../src/components/admin/AdminLessonDescriptionDialog.tsx", import.meta.url), "utf8");
  const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } });
  const componentExports: Record<string, unknown> = {};
  new Function("require", "exports", compiled.outputText)((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, componentExports);
  const Component = componentExports.default as (props: { lesson: AdminLesson; onClose: () => void }) => unknown;
  const render = () => {
    hookIndex = 0;
    return Component({ lesson, onClose: () => { closeCount += 1; } });
  };
  const element = (type: unknown) => {
    const found = findElement(render(), type);
    assert.ok(found, `Missing element: ${String(type)}`);
    return found;
  };
  const hiddenValues = () => {
    const formData = new FormData();
    const collect = (tree: unknown) => {
      if (Array.isArray(tree)) tree.forEach(collect);
      else if (tree && typeof tree === "object" && "props" in tree) {
        const current = tree as TestElement;
        if (current.type === "input") formData.set(String(current.props.name), String(current.props.value));
        collect(current.props.children);
      }
    };
    collect(render());
    formData.set("description", String(element("textarea").props.value));
    return formData;
  };
  return {
    element, lesson, confirmCalls, saveCalls,
    closeCount: () => closeCount,
    setConfirmResult: (value: boolean) => { confirmResult = value; },
    edit: (value: string) => {
      const change = element("textarea").props.onChange as (event: unknown) => void;
      change({ target: { value } });
    },
    submit: () => {
      const action = element("form").props.action as (formData: FormData) => Promise<CourseFormState>;
      return action(hiddenValues());
    },
    close: async () => {
      const close = element("admin-dialog").props.onClose as () => void;
      close();
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    hiddenValues,
  };
}

test("description dialog keeps controlled saved text and advances the CAS token despite an old lesson snapshot", async () => {
  const harness = createDialogHarness();
  harness.edit("  첫 저장  ");
  assert.equal(harness.element("textarea").props.defaultValue, undefined);
  await harness.submit();
  assert.equal(harness.element("textarea").props.value, "첫 저장");
  assert.equal(harness.lesson.description, "기존 설명");
  assert.equal(harness.hiddenValues().get("expectedUpdatedAt"), savedUpdatedAt);
  assert.equal(harness.hiddenValues().get("expectedMissing"), "false");
  await harness.close();
  assert.equal(harness.confirmCalls.length, 0);
  assert.equal(harness.closeCount(), 1);
});

test("failed or conflicting saves preserve the draft and previous token and require dirty-close confirmation", async () => {
  for (const message of ["저장 실패", "다른 곳에서 변경되었습니다."]) {
    const harness = createDialogHarness({ save: async () => ({ status: "error", message, fieldErrors: {} }) });
    harness.edit("삭제되면 안 되는 설명");
    await harness.submit();
    assert.equal(harness.element("textarea").props.value, "삭제되면 안 되는 설명");
    assert.equal(harness.hiddenValues().get("expectedUpdatedAt"), initialUpdatedAt);
    await harness.close();
    assert.equal(harness.confirmCalls.length, 1);
    assert.equal(harness.closeCount(), 0);
    harness.setConfirmResult(true);
    await harness.close();
    assert.equal(harness.closeCount(), 1);
  }
});

test("transport failures retain controlled text and allow a retry with the original token", async () => {
  const harness = createDialogHarness({ save: async () => { throw new Error("network failed"); } });
  harness.edit("재시도할 설명");
  const result = await harness.submit();
  assert.equal(result.status, "error");
  assert.equal(harness.element("textarea").props.value, "재시도할 설명");
  assert.equal(harness.hiddenValues().get("expectedUpdatedAt"), initialUpdatedAt);
  assert.equal(harness.element("admin-dialog").props.busy, false);
});

test("saving blocks dialog close and disables controls until the captured submission resolves", async () => {
  let finish: (state: CourseFormState) => void = () => assert.fail("Save did not start");
  const harness = createDialogHarness({ save: () => new Promise((resolve) => { finish = resolve; }) });
  harness.edit("저장 요청 내용");
  const submission = harness.submit();
  assert.equal(harness.element("admin-dialog").props.busy, true);
  assert.equal(harness.element("textarea").props.disabled, true);
  await harness.close();
  assert.equal(harness.confirmCalls.length, 0);
  assert.equal(harness.closeCount(), 0);
  assert.equal(harness.saveCalls[0].get("description"), "저장 요청 내용");
  assert.equal(harness.saveCalls[0].get("expectedUpdatedAt"), initialUpdatedAt);
  finish({ status: "success", message: "저장", fieldErrors: {}, savedDescription: "저장 요청 내용", savedDescriptionUpdatedAt: savedUpdatedAt });
  await submission;
  assert.equal(harness.element("admin-dialog").props.busy, false);
  await harness.close();
  assert.equal(harness.closeCount(), 1);
});

test("a completed save never replaces edits made after the submitted value was captured", async () => {
  let finish: (state: CourseFormState) => void = () => assert.fail("Save did not start");
  const harness = createDialogHarness({ save: () => new Promise((resolve) => { finish = resolve; }) });
  harness.edit("제출 내용");
  const submission = harness.submit();
  harness.edit("제출 이후 작성 내용");
  finish({ status: "success", message: "저장", fieldErrors: {}, savedDescription: "제출 내용", savedDescriptionUpdatedAt: savedUpdatedAt });
  await submission;
  assert.equal(harness.element("textarea").props.value, "제출 이후 작성 내용");
  assert.equal(harness.hiddenValues().get("expectedUpdatedAt"), savedUpdatedAt);
  await harness.close();
  assert.equal(harness.confirmCalls.length, 1);
  assert.equal(harness.closeCount(), 0);
});

test("the next save uses its last successful timestamp rather than the original lesson snapshot", async () => {
  const harness = createDialogHarness();
  harness.edit("첫 번째 저장");
  await harness.submit();
  harness.edit("두 번째 저장");
  await harness.submit();
  assert.equal(harness.saveCalls[0].get("expectedUpdatedAt"), initialUpdatedAt);
  assert.equal(harness.saveCalls[1].get("expectedUpdatedAt"), savedUpdatedAt);
  assert.equal(harness.element("textarea").props.value, "두 번째 저장");
});

test("missing rows send an insert expectation only until their first successful save", async () => {
  const harness = createDialogHarness({ descriptionUpdatedAt: null });
  assert.equal(harness.hiddenValues().get("expectedMissing"), "true");
  assert.equal(harness.hiddenValues().get("expectedUpdatedAt"), "");
  harness.edit("첫 설명");
  await harness.submit();
  assert.equal(harness.hiddenValues().get("expectedMissing"), "false");
  assert.equal(harness.hiddenValues().get("expectedUpdatedAt"), savedUpdatedAt);
});

test("missing-schema description editing stays disabled while its dialog can close cleanly", async () => {
  const harness = createDialogHarness({ descriptionEditable: false, descriptionUpdatedAt: null });
  assert.equal(harness.element("textarea").props.disabled, true);
  assert.equal(harness.element("dialog-actions").props.disabled, true);
  await harness.close();
  assert.equal(harness.closeCount(), 1);
  assert.equal(harness.confirmCalls.length, 0);
});
