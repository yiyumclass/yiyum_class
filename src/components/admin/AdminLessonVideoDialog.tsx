"use client";

import * as tus from "tus-js-client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  finalizeLessonVideoAction,
  removeLessonVideoAction,
} from "@/app/admin/courses/actions";
import type { AdminLesson } from "@/lib/admin/courses";
import {
  formatVideoDuration,
  formatVideoFileSize,
  readVideoDuration,
  validateCourseVideoFile,
  MAX_COURSE_VIDEO_BYTES,
} from "@/lib/admin/video-file";
import { createClient } from "@/lib/supabase/client";
import AdminDialog from "./AdminDialog";
import { useAdminFeedback } from "./AdminFeedback";
import { AlertIcon, CheckIcon, VideoIcon } from "./icons";
import styles from "./AdminLessonVideoDialog.module.css";

const courseVideoBucket = "course-videos";

const maxVideoMegabytes = Math.floor(MAX_COURSE_VIDEO_BYTES / (1024 * 1024));

type UploadPhase =
  | "idle"
  | "reading"
  | "uploading"
  | "connecting"
  | "success"
  | "error";

type SelectedVideo = {
  file: File;
  durationSeconds: number;
  objectPath: string;
  previewUrl: string;
};

export default function AdminLessonVideoDialog({
  courseSlug,
  sectionTitle,
  lesson,
  storageReady,
  initialFile,
  autoStart = false,
  onClose,
  onComplete,
}: {
  courseSlug: string;
  sectionTitle: string;
  lesson: AdminLesson;
  storageReady: boolean;
  initialFile?: File;
  autoStart?: boolean;
  onClose: () => void;
  onComplete: (message: string) => void;
}) {
  const { confirm } = useAdminFeedback();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadRef = useRef<tus.Upload | null>(null);
  const initialFileHandledRef = useRef(false);
  const autoUploadStartedRef = useRef(false);
  const [selected, setSelected] = useState<SelectedVideo | null>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const busy = phase === "reading" || phase === "uploading" || phase === "connecting";
  const currentPlaybackUrl = lesson.videoPath
    ? `/api/learning/video/${encodeURIComponent(courseSlug)}/${encodeURIComponent(lesson.key)}`
    : null;

  useEffect(() => {
    return () => {
      void uploadRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (selected?.previewUrl) URL.revokeObjectURL(selected.previewUrl);
    };
  }, [selected]);

  const selectFile = useCallback(async (file: File) => {
    if (busy) return;
    setMessage(null);

    const validationMessage = validateCourseVideoFile(file);
    if (validationMessage) {
      setPhase("error");
      setMessage(validationMessage);
      return;
    }

    setPhase("reading");
    const previewUrl = URL.createObjectURL(file);
    try {
      const durationSeconds = await readVideoDuration(previewUrl);
      setSelected({
        file,
        durationSeconds,
        objectPath: `lessons/${lesson.id}/${crypto.randomUUID()}.mp4`,
        previewUrl,
      });
      setPhase("idle");
      setProgress(0);
    } catch {
      URL.revokeObjectURL(previewUrl);
      setPhase("error");
      setMessage("영상 정보를 읽지 못했습니다. 재생 가능한 MP4 파일인지 확인해 주세요.");
    }
  }, [busy, lesson.id]);

  useEffect(() => {
    if (!initialFile || initialFileHandledRef.current) return;
    initialFileHandledRef.current = true;
    void selectFile(initialFile);
  }, [initialFile, selectFile]);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void selectFile(file);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void selectFile(file);
  };

  const startUpload = useCallback(async () => {
    if (!selected || busy || !storageReady) return;
    setMessage(null);
    setPhase("uploading");
    setProgress(0);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setPhase("error");
      setMessage("로그인 정보가 만료되었습니다. 다시 로그인해 주세요.");
      return;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const upload = new tus.Upload(selected.file, {
          endpoint: buildResumableUploadEndpoint(),
          retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
          headers: {
            authorization: `Bearer ${session.access_token}`,
          },
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          metadata: {
            bucketName: courseVideoBucket,
            objectName: selected.objectPath,
            contentType: "video/mp4",
            cacheControl: "3600",
            metadata: JSON.stringify({
              lessonId: lesson.id,
              originalName: selected.file.name,
            }),
          },
          chunkSize: 6 * 1024 * 1024,
          onProgress(bytesUploaded, bytesTotal) {
            setProgress(Math.min(100, Math.round((bytesUploaded / bytesTotal) * 100)));
          },
          onError(error) {
            reject(error);
          },
          onSuccess() {
            resolve();
          },
        });

        uploadRef.current = upload;
        void upload
          .findPreviousUploads()
          .then((previousUploads) => {
            if (previousUploads.length > 0) {
              upload.resumeFromPreviousUpload(previousUploads[0]);
            }
            upload.start();
          })
          .catch(reject);
      });

      uploadRef.current = null;
      setProgress(100);
      setPhase("connecting");
      const result = await finalizeLessonVideoAction(lesson.id, {
        objectPath: selected.objectPath,
        fileName: selected.file.name,
        contentType: "video/mp4",
        sizeBytes: selected.file.size,
        durationSeconds: selected.durationSeconds,
      });

      if (!result.ok) {
        setSelected((current) =>
          current
            ? {
                ...current,
                objectPath: `lessons/${lesson.id}/${crypto.randomUUID()}.mp4`,
              }
            : current
        );
        setPhase("error");
        setMessage(result.message);
        return;
      }

      setPhase("success");
      setMessage(result.message);
    } catch (error) {
      uploadRef.current = null;
      setPhase("error");
      setMessage(formatUploadError(error));
    }
  }, [busy, lesson.id, selected, storageReady]);

  useEffect(() => {
    if (
      !autoStart ||
      autoUploadStartedRef.current ||
      !selected ||
      phase !== "idle"
    ) {
      return;
    }

    autoUploadStartedRef.current = true;
    void startUpload();
  }, [autoStart, phase, selected, startUpload]);

  const cancelUpload = async () => {
    const upload = uploadRef.current;
    if (!upload) return;
    await upload.abort(true);
    uploadRef.current = null;
    setPhase("idle");
    setProgress(0);
    setMessage("업로드를 취소했습니다. 같은 파일을 다시 선택할 수 있습니다.");
  };

  const removeVideo = async () => {
    if (busy) return;

    const confirmed = await confirm({
      title: "연결된 영상을 삭제할까요?",
      description: "영상을 삭제하면 차시는 자동으로 작성 중 상태로 변경됩니다.",
      confirmLabel: "영상 삭제",
      tone: "danger",
    });
    if (!confirmed) return;

    setPhase("connecting");
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
      // 업로드 중 창이 닫히면 tus 업로드가 중단된다. busy 동안 ESC와 배경 클릭을 막는다.
      busy={busy}
      size="large"
      onClose={onClose}
      footer={
        phase !== "success" ? (
          <div className={styles.footer}>
            <p>영상 파일은 비공개 저장소에 보관됩니다.</p>
            <div>
              {phase === "uploading" ? (
                <button type="button" onClick={() => void cancelUpload()}>업로드 취소</button>
              ) : (
                <button type="button" onClick={onClose} disabled={busy}>닫기</button>
              )}
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!selected || busy || !storageReady}
                onClick={() => void startUpload()}
              >
                {phase === "connecting"
                  ? "연결 중..."
                  : phase === "uploading"
                    ? `${progress}% 업로드 중`
                    : lesson.videoPath
                      ? "새 영상으로 교체"
                      : "영상 업로드"}
              </button>
            </div>
          </div>
        ) : null
      }
    >
      <div className={styles.body}>
          {!storageReady && (
            <div className={styles.unavailable} role="status">
              <AlertIcon />
              <div>
                <strong>영상 저장 기능을 준비하고 있습니다.</strong>
                <p>준비가 끝나면 이 화면에서 바로 파일을 업로드할 수 있습니다.</p>
              </div>
            </div>
          )}

          {phase === "success" ? (
            <div className={styles.successState} role="status">
              <span><CheckIcon /></span>
              <strong>{message}</strong>
              <p>강의 목록과 강의실에 변경 내용이 반영됩니다.</p>
              <button type="button" onClick={() => onComplete(message ?? "영상 정보를 변경했습니다.")}>
                강의 목록으로 돌아가기
              </button>
            </div>
          ) : (
            <>
              {lesson.videoPath && !selected && (
                <section className={styles.currentVideo} aria-label="현재 연결된 영상">
                  <div className={styles.sectionHeading}>
                    <div>
                      <span>CURRENT VIDEO</span>
                      <h3>현재 연결된 영상</h3>
                    </div>
                    <span className={styles.readyBadge}>재생 가능</span>
                  </div>
                  {currentPlaybackUrl && (
                    <video
                      className={styles.preview}
                      src={currentPlaybackUrl}
                      controls
                      playsInline
                      preload="metadata"
                    >
                      브라우저에서 영상을 재생할 수 없습니다.
                    </video>
                  )}
                  <div className={styles.fileMeta}>
                    <span>
                      <VideoIcon />
                      <span>
                        <strong>{lesson.videoFileName ?? "연결된 강의 영상"}</strong>
                        <small>
                          {formatVideoDuration(lesson.durationSeconds)}
                          {lesson.videoSizeBytes ? ` · ${formatVideoFileSize(lesson.videoSizeBytes)}` : ""}
                        </small>
                      </span>
                    </span>
                    <button
                      type="button"
                      className={styles.replaceButton}
                      disabled={!storageReady}
                      onClick={() => inputRef.current?.click()}
                    >
                      영상 교체
                    </button>
                  </div>

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

              {(!lesson.videoPath || selected) && (
                <section className={styles.uploadSection} aria-label="새 영상 업로드">
                  <div className={styles.sectionHeading}>
                    <div>
                      <span>{lesson.videoPath ? "REPLACE VIDEO" : "UPLOAD VIDEO"}</span>
                      <h3>{lesson.videoPath ? "새 영상으로 교체" : "영상 파일 업로드"}</h3>
                    </div>
                  </div>

                  {/* 제약을 작은 보조 문구로만 두면 파일을 고른 뒤에야 거부 사실을 알게 된다. */}
                  <p className={styles.constraint}>
                    <AlertIcon />
                    <span>
                      <strong>MP4 형식, 최대 {maxVideoMegabytes}MB까지 올릴 수 있습니다.</strong>
                      <small>이 조건을 넘는 파일은 선택해도 업로드되지 않습니다.</small>
                    </span>
                  </p>

                  {!selected ? (
                    <div
                      className={`${styles.dropzone} ${isDragging ? styles.dropzoneDragging : ""}`}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                          setIsDragging(false);
                        }
                      }}
                      onDrop={handleDrop}
                    >
                      <span><UploadIcon /></span>
                      <strong>{phase === "reading" ? "영상 정보를 확인하고 있습니다" : "MP4 파일을 끌어다 놓으세요"}</strong>
                      <p>720p H.264 MP4 형식을 권장합니다.</p>
                      <button
                        type="button"
                        disabled={!storageReady || phase === "reading"}
                        onClick={() => inputRef.current?.click()}
                      >
                        파일 선택
                      </button>
                    </div>
                  ) : (
                    <div className={styles.selectedVideo}>
                      <video
                        className={styles.preview}
                        src={selected.previewUrl}
                        controls
                        playsInline
                        preload="metadata"
                      >
                        브라우저에서 영상을 재생할 수 없습니다.
                      </video>
                      <div className={styles.selectedMeta}>
                        <span><VideoIcon /></span>
                        <div>
                          <strong>{selected.file.name}</strong>
                          <small>
                            {formatVideoFileSize(selected.file.size)} · {formatVideoDuration(Math.round(selected.durationSeconds))}
                          </small>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setSelected(null);
                            setProgress(0);
                            setMessage(null);
                          }}
                        >
                          다시 선택
                        </button>
                      </div>

                      {(phase === "uploading" || phase === "connecting") && (
                        <div className={styles.progressArea} aria-live="polite">
                          <div>
                            <span>{phase === "connecting" ? "차시에 연결 중" : "업로드 중"}</span>
                            <strong>{progress}%</strong>
                          </div>
                          <div
                            className={styles.progressTrack}
                            role="progressbar"
                            aria-label="영상 업로드 진행률"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={progress}
                          >
                            <span style={{ width: `${progress}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}

              {message && (
                <div className={phase === "error" ? styles.errorMessage : styles.infoMessage} role="status">
                  {phase === "error" && <AlertIcon />}
                  <span>{message}</span>
                </div>
              )}
            </>
          )}

        <input
          ref={inputRef}
          className={styles.fileInput}
          type="file"
          accept="video/mp4,.mp4"
          onChange={handleInputChange}
          tabIndex={-1}
        />
      </div>
    </AdminDialog>
  );
}

function buildResumableUploadEndpoint() {
  const projectUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const hostedMatch = projectUrl.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
  if (hostedMatch) {
    return `https://${hostedMatch[1]}.storage.supabase.co/storage/v1/upload/resumable`;
  }
  return `${projectUrl.origin}/storage/v1/upload/resumable`;
}

function formatUploadError(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  if (/413|maximum|too large|payload/i.test(rawMessage)) {
    return "파일 용량이 현재 업로드 한도를 초과했습니다.";
  }
  if (/401|403|permission|policy|row-level/i.test(rawMessage)) {
    return "영상 업로드 권한을 확인하지 못했습니다. 다시 로그인해 주세요.";
  }
  if (/network|fetch|offline/i.test(rawMessage)) {
    return "네트워크 연결이 불안정합니다. 연결을 확인한 뒤 다시 시도해 주세요.";
  }
  return "영상을 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

/** 공용 아이콘 모음에는 아직 없는 모양이라 이 화면에서만 정의한다. */
function UploadIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V5m0 0L8 9m4-4 4 4" /><path d="M5 15v4h14v-4" /></svg>;
}
