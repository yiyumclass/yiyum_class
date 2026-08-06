"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import * as UpChunk from "@mux/upchunk";
import MuxPlayer from "@mux/mux-player-react";
import {
  createLessonMuxUploadAction,
  getLessonMuxPreviewAction,
  syncLessonMuxVideoAction,
} from "@/app/admin/courses/mux-actions";
import { validateCourseVideoFile } from "@/lib/admin/video-file";
import styles from "./AdminMuxUploadPanel.module.css";

type Phase = "idle" | "starting" | "uploading" | "processing" | "ready" | "error";

// 인코딩은 길이에 비례한다. 3초 간격으로 최대 10분까지 기다린다.
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

export default function AdminMuxUploadPanel({
  lessonId,
  lessonTitle,
  initialFile,
  autoStart = false,
  onBusyChange,
}: {
  lessonId: string;
  lessonTitle: string;
  // 강의 목록에서 파일을 끌어다 놓으면 그 파일이 그대로 넘어온다.
  initialFile?: File;
  autoStart?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    playbackId: string;
    token: string;
  } | null>(null);
  const uploadRef = useRef<UpChunk.UpChunk | null>(null);
  const cancelledRef = useRef(false);
  const initialFileHandledRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      uploadRef.current?.abort();
    };
  }, []);

  const pollUntilReady = useCallback(async () => {
    const startedAt = Date.now();

    while (!cancelledRef.current) {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setPhase("error");
        setMessage(
          "변환이 예상보다 오래 걸립니다. 관리자 화면을 새로고침해 상태를 다시 확인해 주세요."
        );
        return;
      }

      const result = await syncLessonMuxVideoAction(lessonId);
      if (cancelledRef.current) return;

      if (!result.ok) {
        setPhase("error");
        setMessage(result.message);
        return;
      }
      if (result.status === "ready") {
        setPhase("ready");
        setMessage(`${result.message} (${formatDuration(result.durationSeconds)})`);

        // 서명 토큰과 HLS 재생까지 실제로 되는지 이 자리에서 확인한다.
        const preview = await getLessonMuxPreviewAction(lessonId);
        if (preview.ok && !cancelledRef.current) {
          setPreview({ playbackId: preview.playbackId, token: preview.token });
        }
        return;
      }

      setMessage(result.message);
      await sleep(POLL_INTERVAL_MS);
    }
  }, [lessonId]);

  const handleFile = useCallback(
    async (file: File) => {
      // Mux 는 형식을 가리지 않지만, 영상이 아닌 파일은 통째로 올린 뒤에야 실패한다.
      // 3GB 를 다 보내고 나서 알게 되는 일이 없도록 여기서 먼저 걸러낸다.
      const validationMessage = validateCourseVideoFile(file);
      if (validationMessage) {
        setPhase("error");
        setMessage(validationMessage);
        return;
      }

      cancelledRef.current = false;
      setPhase("starting");
      setProgress(0);
      setMessage("업로드를 준비하고 있습니다.");

      const ticket = await createLessonMuxUploadAction(lessonId);
      if (!ticket.ok) {
        setPhase("error");
        setMessage(ticket.message);
        return;
      }

      setPhase("uploading");
      setMessage(null);

      // 파일은 이 서버를 거치지 않고 Mux 로 직접 간다. 크기 제한이 없다.
      const upload = UpChunk.createUpload({
        endpoint: ticket.uploadUrl,
        file,
        chunkSize: 5120,
      });
      uploadRef.current = upload;

      upload.on("progress", (event) => {
        setProgress(Math.min(100, Math.round(event.detail)));
      });

      upload.on("error", (event) => {
        uploadRef.current = null;
        setPhase("error");
        setMessage(
          typeof event.detail?.message === "string"
            ? event.detail.message
            : "업로드에 실패했습니다."
        );
      });

      upload.on("success", () => {
        uploadRef.current = null;
        setProgress(100);
        setPhase("processing");
        setMessage("Mux 가 영상을 변환하는 중입니다.");
        void pollUntilReady();
      });
    },
    [lessonId, pollUntilReady]
  );

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = "";
  };

  // 강의 목록에서 끌어다 놓은 파일은 창이 열리자마자 바로 올린다.
  useEffect(() => {
    if (!initialFile || !autoStart || initialFileHandledRef.current) return;
    initialFileHandledRef.current = true;
    void handleFile(initialFile);
  }, [autoStart, handleFile, initialFile]);

  useEffect(() => {
    onBusyChange?.(
      phase === "starting" || phase === "uploading" || phase === "processing"
    );
  }, [onBusyChange, phase]);

  const cancel = () => {
    cancelledRef.current = true;
    uploadRef.current?.abort();
    uploadRef.current = null;
    setPhase("idle");
    setProgress(0);
    setMessage("업로드를 취소했습니다.");
  };

  const busy = phase === "starting" || phase === "uploading" || phase === "processing";

  return (
    <section className={styles.panel} aria-labelledby={`mux-panel-${lessonId}`}>
      <header className={styles.header}>
        <h3 id={`mux-panel-${lessonId}`} className={styles.title}>
          영상 업로드
        </h3>
        <p className={styles.subtitle}>
          {lessonTitle} · 형식과 용량 제한 없이 올라가며 화질은 자동으로 나뉩니다.
        </p>
      </header>

      {phase === "idle" || phase === "error" ? (
        <label className={styles.picker}>
          <input
            type="file"
            accept="video/*"
            className={styles.input}
            onChange={onInputChange}
          />
          <span className={styles.pickerLabel}>영상 파일 선택</span>
        </label>
      ) : null}

      {phase === "uploading" ? (
        <div className={styles.progressRow}>
          <progress className={styles.progress} value={progress} max={100} />
          <span className={styles.progressValue}>{progress}%</span>
          <button type="button" className={styles.cancel} onClick={cancel}>
            취소
          </button>
        </div>
      ) : null}

      {message ? (
        <p
          className={phase === "error" ? styles.error : styles.message}
          role={phase === "error" ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}

      {busy && phase !== "uploading" ? (
        <p className={styles.message} role="status">
          잠시만 기다려 주세요.
        </p>
      ) : null}

      {preview ? (
        <div className={styles.player}>
          <MuxPlayer
            playbackId={preview.playbackId}
            tokens={{ playback: preview.token }}
            streamType="on-demand"
            accentColor="#D9825E"
          />
        </div>
      ) : null}
    </section>
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}분 ${String(rest).padStart(2, "0")}초`;
}
