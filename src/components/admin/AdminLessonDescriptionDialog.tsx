"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { updateLessonDescriptionAction, type CourseFormState } from "@/app/admin/courses/actions";
import type { AdminLesson } from "@/lib/admin/courses";
import { MAX_LESSON_DESCRIPTION_LENGTH } from "@/lib/learning/lesson-description";
import AdminDialog, { AdminDialogActions } from "./AdminDialog";
import { useAdminFeedback } from "./AdminFeedback";
import styles from "./AdminCourseManager.module.css";

const initialState: CourseFormState = { status: "idle", message: "", fieldErrors: {} };

export default function AdminLessonDescriptionDialog({
  lesson,
  onClose,
}: {
  lesson: AdminLesson;
  onClose: () => void;
}) {
  const { confirm } = useAdminFeedback();
  const [description, setDescription] = useState(lesson.description);
  const [lastSaved, setLastSaved] = useState(lesson.description);
  const [lastSavedUpdatedAt, setLastSavedUpdatedAt] = useState(lesson.descriptionUpdatedAt);
  const savingRef = useRef(false);
  const confirmingCloseRef = useRef(false);
  const unavailable = !lesson.descriptionEditable;
  const [state, formAction, pending] = useActionState(
    async (previous: CourseFormState, formData: FormData): Promise<CourseFormState> => {
      const submittedValue = formData.get("description");
      savingRef.current = true;
      try {
        const result = await updateLessonDescriptionAction(lesson.id, previous, formData);
        if (result.status === "success" && result.savedDescription !== undefined && result.savedDescriptionUpdatedAt) {
          const saved = result.savedDescription;
          setLastSaved(saved);
          setLastSavedUpdatedAt(result.savedDescriptionUpdatedAt);
          setDescription((current) => current === submittedValue ? saved : current);
        }
        return result;
      } catch {
        return {
          status: "error",
          message: "영상 설명을 저장하지 못했습니다. 입력 내용은 유지됩니다. 다시 시도해 주세요.",
          fieldErrors: {},
        };
      } finally {
        savingRef.current = false;
      }
    },
    initialState
  );
  const dirty = description !== lastSaved;

  useEffect(() => {
    if (!dirty && !pending) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty, pending]);

  const requestClose = async () => {
    if (pending || savingRef.current || confirmingCloseRef.current) return;
    confirmingCloseRef.current = true;
    try {
      if (dirty && !await confirm({
        title: "저장하지 않은 영상 설명을 닫을까요?",
        description: "작성한 내용이 사라집니다. 계속 편집하려면 취소해 주세요.",
        confirmLabel: "저장하지 않고 닫기",
        tone: "danger",
      })) return;
      if (!savingRef.current) onClose();
    } finally {
      confirmingCloseRef.current = false;
    }
  };

  return (
    <AdminDialog
      eyebrow="LESSON DESCRIPTION"
      title="영상 설명 수정"
      description={lesson.title}
      busy={pending}
      onClose={() => void requestClose()}
    >
      <form action={formAction} className={styles.lessonDescriptionForm}>
        <input type="hidden" name="expectedUpdatedAt" value={lastSavedUpdatedAt ?? ""} />
        <input type="hidden" name="expectedMissing" value={lastSavedUpdatedAt === null ? "true" : "false"} />
        <label className={styles.formField}>
          <span>영상 설명</span>
          <textarea
            name="description"
            rows={10}
            maxLength={MAX_LESSON_DESCRIPTION_LENGTH}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={unavailable || pending}
            placeholder={"삼각대 사용 방법과 추천 장비를 안내해 주세요.\n\n구매 링크: https://example.com/tripod"}
            aria-describedby="lesson-description-hint"
            aria-invalid={Boolean(state.fieldErrors.description)}
          />
          <small id="lesson-description-hint">
            {unavailable
              ? "영상 설명 기능을 준비하고 있습니다. 준비가 끝나면 수정할 수 있습니다."
              : "수강생에게 영상 아래 표시됩니다. 줄바꿈과 빈 줄로 문단을 나눌 수 있으며 http/https 주소는 링크로 표시됩니다. 최대 10,000자."}
          </small>
          {state.fieldErrors.description && (
            <small className={styles.fieldError} role="alert">{state.fieldErrors.description}</small>
          )}
        </label>
        {state.status === "error" && <p className={styles.formError} role="alert">{state.message}</p>}
        {state.status === "success" && <p className={styles.lessonDescriptionSaved} role="status">{state.message}</p>}
        <AdminDialogActions
          busy={pending}
          disabled={unavailable || !dirty}
          onClose={() => void requestClose()}
          submitLabel="영상 설명 저장"
          busyLabel="설명 저장 중"
        />
      </form>
    </AdminDialog>
  );
}
