"use client";

import { useState } from "react";
import AdminMuxUploadPanel from "@/components/admin/AdminMuxUploadPanel";
import { removeLessonVideoAction } from "@/app/admin/courses/actions";
import type { AdminLesson } from "@/lib/admin/courses";
import { formatVideoDuration } from "@/lib/admin/video-file";
import AdminDialog from "./AdminDialog";
import { useAdminFeedback } from "./AdminFeedback";
import { AlertIcon, CheckIcon, VideoIcon } from "./icons";
import styles from "./AdminLessonVideoDialog.module.css";

type DialogPhase = "idle" | "removing" | "success" | "error";

export default function AdminLessonVideoDialog({
  sectionTitle,
  lesson,
  initialFile,
  autoStart = false,
  onClose,
  onComplete,
}: {
  sectionTitle: string;
  lesson: AdminLesson;
  initialFile?: File;
  autoStart?: boolean;
  onClose: () => void;
  onComplete: (message: string) => void;
}) {
  const { confirm } = useAdminFeedback();
  const [phase, setPhase] = useState<DialogPhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const busy = phase === "removing" || isUploading;

  const removeVideo = async () => {
    if (busy) return;

    const confirmed = await confirm({
      title: "연결된 영상을 삭제할까요?",
      description:
        "영상을 삭제하면 차시는 자동으로 작성 중 상태로 변경되고, Mux 보관 자리도 하나 돌아옵니다. 수강 기록은 그대로 남습니다.",
      confirmLabel: "영상 삭제",
      tone: "danger",
    });
    if (!confirmed) return;

    setPhase("removing");
    setMessage(null);
    const result = await removeLessonVideoAction(lesson.id);
    if (!result.ok) {
      setPhase("error");
      setMessage(result.message);
      return;
    }
    setPhase("success");
    setMessage(result.message);
  };

  return (
    <AdminDialog
      eyebrow="LESSON VIDEO"
      title="강의 영상 관리"
      description={`${sectionTitle} · ${lesson.title}`}
      // 업로드 중 창이 닫히면 전송이 끊긴다. 그동안 ESC와 배경 클릭을 막는다.
      busy={busy}
      size="large"
      onClose={onClose}
      footer={
        <div className={styles.footer}>
          <p>영상은 Mux 에 보관되며 서명된 주소로만 재생됩니다.</p>
          <div>
            <button type="button" onClick={onClose} disabled={busy}>
              닫기
            </button>
          </div>
        </div>
      }
    >
      <div className={styles.body}>
        {phase === "success" ? (
          <div className={styles.successState} role="status">
            <span>
              <CheckIcon />
            </span>
            <strong>{message}</strong>
            <p>강의 목록과 강의실에 변경 내용이 반영됩니다.</p>
            <button
              type="button"
              onClick={() => onComplete(message ?? "영상 정보를 변경했습니다.")}
            >
              강의 목록으로 돌아가기
            </button>
          </div>
        ) : (
          <>
            {lesson.hasVideo && (
              <section
                className={styles.currentVideo}
                aria-label="현재 연결된 영상"
              >
                <div className={styles.sectionHeading}>
                  <div>
                    <span>CURRENT VIDEO</span>
                    <h3>현재 연결된 영상</h3>
                  </div>
                  <span className={styles.readyBadge}>재생 가능</span>
                </div>
                <div className={styles.fileMeta}>
                  <span>
                    <VideoIcon />
                    <span>
                      <strong>연결된 강의 영상</strong>
                      <small>
                        {formatVideoDuration(lesson.durationSeconds)} · Mux
                      </small>
                    </span>
                  </span>
                </div>

                {/* 접은 강의를 통째로 지우지 않고도 보관 비용을 줄일 수 있다는 걸 알려준다. */}
                <p className={styles.removeHint}>
                  강의를 접었다면 영상만 지워도 됩니다. 차시와 수강 기록은 남고
                  Mux 보관 자리만 돌아옵니다.
                </p>
                <button
                  type="button"
                  className={styles.removeButton}
                  disabled={busy}
                  onClick={() => void removeVideo()}
                >
                  현재 영상 삭제
                </button>
              </section>
            )}

            <AdminMuxUploadPanel
              lessonId={lesson.id}
              lessonTitle={lesson.title}
              initialFile={initialFile}
              autoStart={autoStart}
              onBusyChange={setIsUploading}
            />

            {message && (
              <div
                className={
                  phase === "error" ? styles.errorMessage : styles.infoMessage
                }
                role="status"
              >
                {phase === "error" && <AlertIcon />}
                <span>{message}</span>
              </div>
            )}
          </>
        )}
      </div>
    </AdminDialog>
  );
}
