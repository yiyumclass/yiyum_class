"use client";

import Image from "next/image";
import Link from "next/link";
import MuxPlayer from "@mux/mux-player-react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import styles from "./CourseClassroom.module.css";

/**
 * video 태그와 Mux Player 가 공통으로 갖는 재생 상태.
 * 진도 저장·이어보기는 이 세 가지만 쓰므로 플레이어 종류를 몰라도 된다.
 */
type PlayerElement = Pick<
  HTMLMediaElement,
  | "currentTime"
  | "duration"
  | "readyState"
  | "addEventListener"
  | "removeEventListener"
>;
import type {
  Course,
  CourseLesson,
  CourseProgress,
} from "@/lib/learning/types";
import {
  calculateCourseProgressPercent,
  calculateLessonProgressPercent,
} from "@/lib/learning/progress";

type FlatLesson = CourseLesson & {
  sectionId: string;
  sectionTitle: string;
  sectionIndex: number;
  lessonIndex: number;
  globalIndex: number;
};

type CompletionAction = "preserve" | "complete" | "incomplete";

type VideoPlaybackState = "ok" | "recovering" | "failed";

// 서명 URL 만료·일시적 스토리지 오류는 재요청으로 대부분 복구된다.
// 이 횟수를 넘기면 자동 복구를 멈추고 사용자에게 재시도를 맡긴다.
const MAX_VIDEO_RECOVERY_ATTEMPTS = 2;

type ProgressSavePayload = {
  courseSlug: string;
  lessonId: string;
  positionSeconds: number;
  durationSeconds: number;
  completionAction: CompletionAction;
};

export default function CourseClassroom({
  course,
  initialProgress,
  displayName,
  progressPersistenceEnabled,
  isAdminPreview = false,
}: {
  course: Course;
  initialProgress: CourseProgress;
  displayName: string;
  progressPersistenceEnabled: boolean;
  isAdminPreview?: boolean;
}) {
  const flatLessons: FlatLesson[] = course.sections.flatMap((section, sectionIndex) =>
    section.lessons.map((item, lessonIndex) => ({
      ...item,
      sectionId: section.id,
      sectionTitle: section.title,
      sectionIndex,
      lessonIndex,
      globalIndex: course.sections
        .slice(0, sectionIndex)
        .reduce((total, current) => total + current.lessons.length, 0) + lessonIndex,
    }))
  );
  const availableFlatLessons = flatLessons.filter(
    (lesson) => lesson.availability !== "coming-soon"
  );
  const fallbackLesson = availableFlatLessons[0];
  const progressLesson = availableFlatLessons.find(
    (item) => item.id === initialProgress.currentLessonId
  );
  const [activeLessonId, setActiveLessonId] = useState(
    progressLesson?.id ?? fallbackLesson?.id ?? ""
  );
  const [completedLessonIds, setCompletedLessonIds] = useState(
    initialProgress.completedLessonIds
  );
  const [openSectionIds, setOpenSectionIds] = useState<string[]>([
    progressLesson?.sectionId ?? course.sections[0]?.id ?? "",
  ]);
  const [isCurriculumOpen, setIsCurriculumOpen] = useState(false);
  const [positionsByLessonId, setPositionsByLessonId] = useState(
    initialProgress.positionsByLessonId
  );
  const [failedProgressSave, setFailedProgressSave] =
    useState<ProgressSavePayload | null>(null);
  const [isRetryingProgressSave, setIsRetryingProgressSave] = useState(false);
  const [videoPlaybackState, setVideoPlaybackState] =
    useState<VideoPlaybackState>("ok");
  const [isVideoBuffering, setIsVideoBuffering] = useState(false);
  const [videoReloadNonce, setVideoReloadNonce] = useState(0);
  const videoRecoveryAttemptsRef = useRef(0);
  const videoResumePositionRef = useRef(0);
  // video 태그와 Mux Player 를 함께 쓴다. 진도 로직이 건드리는 속성은 양쪽 다 같아서
  // 그 부분만 추려 하나의 타입으로 다룬다.
  const videoRef = useRef<PlayerElement | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const lastQueuedPositionsRef = useRef<Record<string, number>>({
    ...initialProgress.positionsByLessonId,
  });
  const autoCompletionSuppressedRef = useRef<Set<string>>(new Set());
  const restoredVideoElementsRef = useRef<WeakSet<PlayerElement>>(
    new WeakSet()
  );
  const [muxPlayback, setMuxPlayback] = useState<{
    lessonId: string;
    playbackId: string;
    token: string;
  } | null>(null);

  const activeLesson =
    availableFlatLessons.find((item) => item.id === activeLessonId) ??
    availableFlatLessons[0]!;

  const completedCount = completedLessonIds.length;
  const progress = calculateCourseProgressPercent(course, {
    completedLessonIds,
    positionsByLessonId,
  });
  const isCurrentComplete = completedLessonIds.includes(activeLesson.id);
  const currentLessonProgress = calculateLessonProgressPercent(
    activeLesson.durationSeconds,
    positionsByLessonId[activeLesson.id] ?? 0,
    isCurrentComplete
  );
  const activeAvailableIndex = availableFlatLessons.findIndex(
    (lesson) => lesson.id === activeLesson.id
  );
  const previousLesson = availableFlatLessons[activeAvailableIndex - 1];
  const nextLesson = availableFlatLessons[activeAvailableIndex + 1];

  // 영상 API는 매 요청 새 서명 URL로 리다이렉트한다. 만료로 재생이 끊기면
  // 질의 문자열만 바꿔 다시 요청해 새 URL을 받는다.
  const activeVideoSrc = activeLesson.videoSrc
    ? videoReloadNonce > 0
      ? `${activeLesson.videoSrc}${activeLesson.videoSrc.includes("?") ? "&" : "?"}reload=${videoReloadNonce}`
      : activeLesson.videoSrc
    : undefined;

  // Mux 는 서명 토큰이 필요하다. 차시가 바뀌거나 만료로 다시 불러올 때마다 새로 받는다.
  useEffect(() => {
    // 다른 차시의 토큰이 남아 있어도 렌더에서 lessonId 를 비교해 걸러내므로
    // 여기서 따로 비우지 않는다.
    if (!activeLesson.videoSrc) return;

    let cancelled = false;
    const lessonId = activeLesson.id;

    void (async () => {
      try {
        const response = await fetch(
          `${activeLesson.videoSrc}?format=json&reload=${videoReloadNonce}`,
          { cache: "no-store" }
        );
        if (!response.ok) throw new Error(`status ${response.status}`);

        const data = (await response.json()) as {
          playbackId?: string;
          token?: string;
        };
        if (cancelled) return;
        if (!data.playbackId || !data.token) throw new Error("missing playback");

        setMuxPlayback({
          lessonId,
          playbackId: data.playbackId,
          token: data.token,
        });
      } catch {
        if (!cancelled) setVideoPlaybackState("failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeLesson.id,
    activeLesson.videoSrc,
    videoReloadNonce,
  ]);

  const enqueueProgressSave = useCallback(
    (payload: ProgressSavePayload, { retry = false }: { retry?: boolean } = {}) => {
      if (retry) {
        setIsRetryingProgressSave(true);
      }

      saveChainRef.current = saveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const response = await fetch("/api/learning/progress", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
              keepalive: true,
            });

            if (!response.ok) {
              throw new Error(`Progress save failed: ${response.status}`);
            }

            setFailedProgressSave((current) =>
              current === payload ? null : current
            );
          } catch {
            setFailedProgressSave(payload);
          } finally {
            if (retry) {
              setIsRetryingProgressSave(false);
            }
          }
        });
    },
    []
  );

  const queueProgressSave = useCallback(
    (
      lessonId: string,
      lessonDurationSeconds: number,
      positionSeconds: number,
      durationSeconds: number,
      completionAction: CompletionAction
    ) => {
      const safeDuration = Number.isFinite(durationSeconds)
        ? Math.max(0, durationSeconds)
        : lessonDurationSeconds;
      const safePosition = Number.isFinite(positionSeconds)
        ? Math.max(0, Math.min(positionSeconds, safeDuration || 0))
        : 0;

      lastQueuedPositionsRef.current[lessonId] = safePosition;
      setPositionsByLessonId((current) => ({
        ...current,
        [lessonId]: Math.round(safePosition),
      }));

      if (!progressPersistenceEnabled) {
        return;
      }

      enqueueProgressSave({
        courseSlug: course.slug,
        lessonId,
        positionSeconds: safePosition,
        durationSeconds: safeDuration,
        completionAction,
      });
    },
    [course.slug, enqueueProgressSave, progressPersistenceEnabled]
  );

  const persistActiveVideo = (
    completionAction: CompletionAction = "preserve"
  ) => {
    const video = videoRef.current;
    const position =
      video?.currentTime ?? positionsByLessonId[activeLesson.id] ?? 0;
    const duration = Number.isFinite(video?.duration)
      ? video?.duration ?? activeLesson.durationSeconds
      : activeLesson.durationSeconds;

    if (completionAction === "preserve" && position < 1) return;

    queueProgressSave(
      activeLesson.id,
      activeLesson.durationSeconds,
      position,
      duration,
      completionAction
    );
  };

  const persistProgressOnExit = useEffectEvent(() => persistActiveVideo());

  useEffect(() => {
    const handlePageHide = () => persistProgressOnExit();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") persistProgressOnExit();
    };

    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const restoreSavedPosition = () => {
      if (restoredVideoElementsRef.current.has(video)) return;
      restoredVideoElementsRef.current.add(video);

      const savedPosition = positionsByLessonId[activeLessonId] ?? 0;
      const isComplete = completedLessonIds.includes(activeLessonId);

      if (
        !isComplete &&
        savedPosition > 0 &&
        savedPosition < video.duration - 2
      ) {
        video.currentTime = savedPosition;
      }
    };

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      restoreSavedPosition();
      return;
    }

    video.addEventListener("loadedmetadata", restoreSavedPosition, { once: true });
    return () => video.removeEventListener("loadedmetadata", restoreSavedPosition);
  }, [activeLessonId, completedLessonIds, positionsByLessonId]);

  const openLesson = (item: FlatLesson) => {
    if (item.availability === "coming-soon") return;
    persistActiveVideo();
    resetVideoPlaybackState();
    setActiveLessonId(item.id);
    setOpenSectionIds((current) =>
      current.includes(item.sectionId) ? current : [...current, item.sectionId]
    );
    setIsCurriculumOpen(false);
  };

  const returnToMyClass = () => {
    persistActiveVideo();
  };

  const retryFailedProgressSave = () => {
    if (!failedProgressSave) return;
    enqueueProgressSave(failedProgressSave, { retry: true });
  };

  // 차시를 옮기면 이전 차시의 복구 시도 이력이 남지 않도록 되돌린다.
  const resetVideoPlaybackState = () => {
    videoRecoveryAttemptsRef.current = 0;
    videoResumePositionRef.current = 0;
    setVideoReloadNonce(0);
    setVideoPlaybackState("ok");
    setIsVideoBuffering(false);
  };

  const reloadVideoSource = () => {
    const video = videoRef.current;
    videoResumePositionRef.current =
      video && Number.isFinite(video.currentTime) ? video.currentTime : 0;
    setVideoPlaybackState("recovering");
    setVideoReloadNonce((current) => current + 1);
  };

  const handleVideoError = () => {
    if (videoRecoveryAttemptsRef.current >= MAX_VIDEO_RECOVERY_ATTEMPTS) {
      setIsVideoBuffering(false);
      setVideoPlaybackState("failed");
      return;
    }

    videoRecoveryAttemptsRef.current += 1;
    reloadVideoSource();
  };

  const retryVideoPlayback = () => {
    videoRecoveryAttemptsRef.current = 0;
    reloadVideoSource();
  };

  const handleVideoPlayable = () => {
    setIsVideoBuffering(false);
    setVideoPlaybackState("ok");
    videoRecoveryAttemptsRef.current = 0;

    const video = videoRef.current;
    const resumeAt = videoResumePositionRef.current;
    videoResumePositionRef.current = 0;

    if (
      video &&
      resumeAt > 0 &&
      Number.isFinite(video.duration) &&
      resumeAt < video.duration - 1 &&
      Math.abs(video.currentTime - resumeAt) > 1
    ) {
      video.currentTime = resumeAt;
    }
  };

  const toggleSection = (sectionId: string) => {
    setOpenSectionIds((current) =>
      current.includes(sectionId)
        ? current.filter((id) => id !== sectionId)
        : [...current, sectionId]
    );
  };

  const toggleComplete = () => {
    setCompletedLessonIds((current) =>
      current.includes(activeLesson.id)
        ? current.filter((id) => id !== activeLesson.id)
        : [...current, activeLesson.id]
    );
    if (isCurrentComplete) {
      autoCompletionSuppressedRef.current.add(activeLesson.id);
    } else {
      autoCompletionSuppressedRef.current.delete(activeLesson.id);
    }
    persistActiveVideo(isCurrentComplete ? "incomplete" : "complete");
  };

  const handleVideoProgress = (video: PlayerElement) => {
    const currentPosition = Math.floor(video.currentTime);
    const lastQueuedPosition =
      lastQueuedPositionsRef.current[activeLesson.id] ?? 0;
    const watchedRatio =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.currentTime / video.duration
        : 0;

    if (watchedRatio < 0.5) {
      autoCompletionSuppressedRef.current.delete(activeLesson.id);
    }

    if (
      !isCurrentComplete &&
      !autoCompletionSuppressedRef.current.has(activeLesson.id) &&
      watchedRatio >= 0.9
    ) {
      setCompletedLessonIds((current) =>
        current.includes(activeLesson.id) ? current : [...current, activeLesson.id]
      );
      queueProgressSave(
        activeLesson.id,
        activeLesson.durationSeconds,
        video.currentTime,
        video.duration,
        "complete"
      );
      return;
    }

    if (Math.abs(currentPosition - lastQueuedPosition) >= 15) {
      queueProgressSave(
        activeLesson.id,
        activeLesson.durationSeconds,
        video.currentTime,
        video.duration,
        "preserve"
      );
    }
  };

  const handleVideoEnded = (video: PlayerElement) => {
    const isAutoCompletionSuppressed =
      autoCompletionSuppressedRef.current.has(activeLesson.id);

    if (!isCurrentComplete && !isAutoCompletionSuppressed) {
      setCompletedLessonIds((current) =>
        current.includes(activeLesson.id) ? current : [...current, activeLesson.id]
      );
    }
    queueProgressSave(
      activeLesson.id,
      activeLesson.durationSeconds,
      video.duration,
      video.duration,
      isAutoCompletionSuppressed ? "preserve" : "complete"
    );
  };

  return (
    <div className={styles.page}>
      {isAdminPreview && (
        <div className={styles.adminPreviewBanner} role="status">
          <strong>관리자 미리보기</strong>
          <span>작성 중 콘텐츠까지 포함한 검수 화면입니다. 진도 변경은 저장되지 않습니다.</span>
        </div>
      )}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link
            href={isAdminPreview ? "/admin/courses" : "/my"}
            className={styles.backLink}
            onClick={isAdminPreview ? undefined : returnToMyClass}
          >
            <BackIcon />
            <span>{isAdminPreview ? "강의 관리" : "마이 클래스"}</span>
          </Link>

          <Link href="/" className={`serif ${styles.brand}`} aria-label="이윰 클래스 홈">
            이윰 클래스
          </Link>

          <div className={styles.headerProgress}>
            <span className={styles.userName}>{isAdminPreview ? "ADMIN PREVIEW" : `${displayName}님`}</span>
            <span className={styles.progressCopy}>
              {isAdminPreview ? (
                <>작성 중 포함 · 총 {availableFlatLessons.length}강</>
              ) : (
                <><strong>{formatProgressPercent(progress)}%</strong> · {completedCount} / {availableFlatLessons.length}강</>
              )}
            </span>
            <div
              className={styles.headerProgressTrack}
              role="progressbar"
              aria-label={`${course.title} 수강 진도`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      </header>

      <main className={styles.classroom}>
        <section className={styles.lessonColumn} aria-labelledby="lesson-title">
          <div className={styles.playerFrame}>
            {activeVideoSrc ? (
              <>
                {muxPlayback && muxPlayback.lessonId === activeLesson.id ? (
                  <MuxPlayer
                    key={`${activeLesson.id}-${videoReloadNonce}`}
                    ref={(element) => {
                      videoRef.current = element;
                    }}
                    className={styles.video}
                    playbackId={muxPlayback.playbackId}
                    tokens={{ playback: muxPlayback.token }}
                    streamType="on-demand"
                    poster={course.posterSrc || undefined}
                    playsInline
                    preload="metadata"
                    accentColor="#D9825E"
                    title={`${activeLesson.title} 강의 영상`}
                    onTimeUpdate={() => {
                      if (videoRef.current) handleVideoProgress(videoRef.current);
                    }}
                    onPause={() => persistActiveVideo()}
                    onEnded={() => {
                      if (videoRef.current) handleVideoEnded(videoRef.current);
                    }}
                    onError={handleVideoError}
                    onWaiting={() => setIsVideoBuffering(true)}
                    onCanPlay={handleVideoPlayable}
                    onPlaying={handleVideoPlayable}
                  />
                ) : null}
                {videoPlaybackState === "failed" ? (
                  <div className={styles.videoErrorOverlay} role="alert">
                    <strong>영상을 불러오지 못했습니다</strong>
                    <span>
                      네트워크 상태를 확인해 주세요. 로그인이 만료됐다면 다시
                      로그인한 뒤 이어볼 수 있습니다.
                    </span>
                    <button type="button" onClick={retryVideoPlayback}>
                      다시 불러오기
                    </button>
                  </div>
                ) : (
                  (isVideoBuffering || videoPlaybackState === "recovering") && (
                    <div className={styles.videoLoadingOverlay} role="status">
                      <span className={styles.videoSpinner} aria-hidden="true" />
                      <span>
                        {videoPlaybackState === "recovering"
                          ? "영상을 다시 불러오는 중"
                          : "영상을 불러오는 중"}
                      </span>
                    </div>
                  )
                )}
              </>
            ) : (
              <>
                {/* 포스터는 강의 등록 시 선택 입력이라 비어 있을 수 있다.
                    빈 문자열을 그대로 넘기면 next/image가 예외를 던진다. */}
                {course.posterSrc && (
                  <Image
                    src={course.posterSrc}
                    alt=""
                    fill
                    loading="eager"
                    fetchPriority="high"
                    sizes="(max-width: 920px) 100vw, 70vw"
                    className={styles.poster}
                  />
                )}
                <div className={styles.playerShade} aria-hidden="true" />
                <button
                  type="button"
                  disabled
                  className={styles.playButton}
                  aria-label={`${activeLesson.title} 영상 준비 중`}
                >
                  <PlayIcon />
                </button>
                <div className={styles.playerCaption} aria-hidden="true">
                  <span>VIDEO COMING SOON</span>
                  <strong>{activeLesson.title}</strong>
                </div>
              </>
            )}
          </div>

          <div className={styles.lessonDetails}>
            {failedProgressSave && !isAdminPreview && (
              <div className={styles.progressSaveWarning} role="alert">
                <span>
                  진도 저장에 실패했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.
                </span>
                <button
                  type="button"
                  onClick={retryFailedProgressSave}
                  disabled={isRetryingProgressSave}
                >
                  {isRetryingProgressSave ? "재시도 중" : "다시 저장"}
                </button>
              </div>
            )}

            <div className={styles.lessonTopline}>
              <span>
                CHAPTER {String(activeLesson.sectionIndex + 1).padStart(2, "0")} ·
                LESSON {String(activeLesson.globalIndex + 1).padStart(2, "0")}
              </span>
              <span>
                {formatDuration(activeLesson.durationSeconds)} · {currentLessonProgress}% 시청
              </span>
            </div>

            <div className={styles.titleRow}>
              <div>
                <p>{activeLesson.sectionTitle}</p>
                <h1 id="lesson-title" className="serif">
                  <LessonTitle title={activeLesson.title} />
                </h1>
              </div>
              <button
                type="button"
                className={isCurrentComplete ? styles.completeButtonActive : styles.completeButton}
                aria-pressed={isCurrentComplete}
                onClick={toggleComplete}
              >
                <CheckIcon />
                {isCurrentComplete ? "학습 완료" : "완료로 표시"}
              </button>
            </div>

            <nav className={styles.lessonNavigation} aria-label="차시 이동">
              {previousLesson ? (
                <button
                  type="button"
                  className={styles.previousLessonButton}
                  aria-label="이전 강의"
                  onClick={() => openLesson(previousLesson)}
                >
                  <span className={styles.navigationContent} aria-hidden="true">
                    <span className={styles.navigationArrow} />
                    <span className={styles.navigationLabel}>이전 강의</span>
                  </span>
                </button>
              ) : (
                <span className={styles.navigationPlaceholder} />
              )}

              {nextLesson ? (
                <button
                  type="button"
                  className={styles.nextLessonButton}
                  aria-label="다음 강의"
                  onClick={() => openLesson(nextLesson)}
                >
                  <span className={styles.navigationContent} aria-hidden="true">
                    <span className={styles.navigationLabel}>다음 강의</span>
                    <span className={styles.navigationArrow} />
                  </span>
                </button>
              ) : (
                <span className={styles.courseCompleteCopy}>마지막 강의입니다</span>
              )}
            </nav>
          </div>

          <button
            type="button"
            className={styles.mobileCurriculumButton}
            aria-expanded={isCurriculumOpen}
            aria-controls="course-curriculum"
            onClick={() => setIsCurriculumOpen((current) => !current)}
          >
            <span>
              <ListIcon /> 커리큘럼
            </span>
            <strong>
              {isCurriculumOpen
                ? "접기"
                : `${activeLesson.globalIndex + 1} / ${flatLessons.length}강`}
            </strong>
          </button>
        </section>

        <aside
          id="course-curriculum"
          className={`${styles.curriculum} ${isCurriculumOpen ? styles.curriculumOpen : ""}`}
          aria-label="강의 커리큘럼"
        >
          <div className={styles.curriculumHeader}>
            <span className={styles.curriculumEyebrow}>CURRICULUM</span>
            <h2 className="serif">{course.shortTitle}</h2>
            <p>
              {course.instructor} · 전체 {flatLessons.length}강 · 공개 {availableFlatLessons.length}강
            </p>
            <div className={styles.curriculumProgressRow}>
              <span>{completedCount}강 완료</span>
              <strong>{formatProgressPercent(progress)}%</strong>
            </div>
            <div className={styles.curriculumProgressTrack} aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className={styles.sectionList}>
            {course.sections.map((section, sectionIndex) => {
              const isOpen = openSectionIds.includes(section.id);
              const sectionCompletedCount = section.lessons.filter((item) =>
                completedLessonIds.includes(item.id)
              ).length;
              const sectionAvailableCount = section.lessons.filter(
                (item) => item.availability !== "coming-soon"
              ).length;

              return (
                <section className={styles.curriculumSection} key={section.id}>
                  <button
                    type="button"
                    className={styles.sectionToggle}
                    aria-expanded={isOpen}
                    aria-controls={`section-${section.id}`}
                    onClick={() => toggleSection(section.id)}
                  >
                    <span className={styles.sectionNumber}>
                      {String(sectionIndex + 1).padStart(2, "0")}
                    </span>
                    <span className={styles.sectionHeading}>
                      <strong>{section.title}</strong>
                      <small>
                        {sectionAvailableCount > 0
                          ? `${sectionCompletedCount}/${sectionAvailableCount}강 완료 · 총 ${section.lessons.length}강`
                          : `총 ${section.lessons.length}강 · 추후 공개`}
                      </small>
                    </span>
                    <ChevronIcon />
                  </button>

                  {isOpen && (
                    <ol id={`section-${section.id}`} className={styles.lessonList}>
                      {section.lessons.map((item, lessonIndex) => {
                        const itemGlobalIndex = course.sections
                          .slice(0, sectionIndex)
                          .reduce((total, current) => total + current.lessons.length, 0) + lessonIndex;
                        const flatItem = flatLessons[itemGlobalIndex];
                        const isComingSoon = item.availability === "coming-soon";
                        const isActive = item.id === activeLesson.id;
                        const isComplete = completedLessonIds.includes(item.id);
                        const lessonProgress = calculateLessonProgressPercent(
                          item.durationSeconds,
                          positionsByLessonId[item.id] ?? 0,
                          isComplete
                        );
                        const lessonProgressLabel = isComplete
                          ? "학습 완료"
                          : isComingSoon
                            ? "추후 공개"
                          : lessonProgress > 0
                            ? `${lessonProgress}% 시청`
                            : "미완료";

                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              className={
                                isComingSoon
                                  ? styles.lessonRowComingSoon
                                  : isActive
                                    ? styles.lessonRowActive
                                    : styles.lessonRow
                              }
                              disabled={isComingSoon}
                              aria-current={isActive ? "step" : undefined}
                              aria-label={`${itemGlobalIndex + 1}강 ${item.title}, ${lessonProgressLabel}`}
                              onClick={() => openLesson(flatItem)}
                            >
                              <span
                                className={
                                  isComplete
                                    ? styles.lessonCheckDone
                                    : isComingSoon
                                      ? styles.lessonCheckLocked
                                      : styles.lessonCheck
                                }
                              >
                                {isComplete ? (
                                  <CheckMarkIcon />
                                ) : !isComingSoon && lessonProgress > 0 ? (
                                  <LessonProgressRing percent={lessonProgress} />
                                ) : null}
                              </span>
                              <span className={styles.lessonRowCopy}>
                                <strong>{item.title}</strong>
                                <small>
                                  {formatDuration(item.durationSeconds)} · {isComingSoon
                                    ? "추후 공개"
                                    : isComplete
                                    ? "완료"
                                    : lessonProgress > 0
                                      ? `${lessonProgress}% 시청`
                                      : item.videoSrc
                                        ? "재생 가능"
                                      : "미완료"}
                                </small>
                              </span>
                              {isComingSoon ? (
                                <span className={styles.comingSoon}>추후 공개</span>
                              ) : isActive ? (
                                <span className={styles.nowPlaying}>재생 중</span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </section>
              );
            })}
          </div>

        </aside>
      </main>
    </div>
  );
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatProgressPercent(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function LessonTitle({ title }: { title: string }) {
  const [firstLine, ...remainingParts] = title.split(" — ");

  if (remainingParts.length === 0) return title;

  return (
    <>
      {firstLine} —
      <br />
      {remainingParts.join(" — ")}
    </>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m11.8 4.5-5.5 5.5 5.5 5.5M6.7 10h7" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true">
      <path d="m10.5 8 9 6-9 6Z" />
    </svg>
  );
}

/** 원 둘레에 시청 진행률을 그린다. 미시청은 빈 원, 완료는 채운 원이라 세 상태가 한눈에 갈린다. */
const LESSON_RING_RADIUS = 12.5;
const LESSON_RING_CIRCUMFERENCE = 2 * Math.PI * LESSON_RING_RADIUS;

function LessonProgressRing({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = (clamped / 100) * LESSON_RING_CIRCUMFERENCE;

  return (
    <svg className={styles.lessonProgressRing} viewBox="0 0 26 26" aria-hidden="true">
      <circle
        cx="13"
        cy="13"
        r={LESSON_RING_RADIUS}
        strokeDasharray={`${filled} ${LESSON_RING_CIRCUMFERENCE - filled}`}
        transform="rotate(-90 13 13)"
      />
    </svg>
  );
}

/** 채운 원 위에 얹는 체크. CheckIcon과 달리 테두리 원을 그리지 않는다. */
function CheckMarkIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="m4.6 9.3 2.9 2.9 5.9-6.1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="7.5" />
      <path d="m5.7 9.1 2.1 2.1 4.6-4.8" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5.5 8 4.5 4 4.5-4" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7 5.5h8M7 10h8M7 14.5h8" />
      <circle cx="4" cy="5.5" r=".7" />
      <circle cx="4" cy="10" r=".7" />
      <circle cx="4" cy="14.5" r=".7" />
    </svg>
  );
}
