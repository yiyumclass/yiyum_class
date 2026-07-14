"use client";

import Image from "next/image";
import Link from "next/link";
import type { MouseEvent, SyntheticEvent } from "react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import styles from "./CourseClassroom.module.css";
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

export default function CourseClassroom({
  course,
  initialProgress,
  displayName,
  progressPersistenceEnabled,
}: {
  course: Course;
  initialProgress: CourseProgress;
  displayName: string;
  progressPersistenceEnabled: boolean;
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
  const fallbackLesson = flatLessons[0];
  const progressLesson = flatLessons.find(
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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const lastQueuedPositionsRef = useRef<Record<string, number>>({
    ...initialProgress.positionsByLessonId,
  });
  const autoCompletionSuppressedRef = useRef<Set<string>>(new Set());
  const restoredVideoElementsRef = useRef<WeakSet<HTMLVideoElement>>(
    new WeakSet()
  );

  const activeLesson =
    flatLessons.find((item) => item.id === activeLessonId) ?? flatLessons[0]!;

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
  const previousLesson = flatLessons[activeLesson.globalIndex - 1];
  const nextLesson = flatLessons[activeLesson.globalIndex + 1];

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

      saveChainRef.current = saveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const response = await fetch("/api/learning/progress", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                courseSlug: course.slug,
                lessonId,
                positionSeconds: safePosition,
                durationSeconds: safeDuration,
                completionAction,
              }),
              keepalive: true,
            });

            if (!response.ok) throw new Error(`Progress save failed: ${response.status}`);
          } catch {}
        });
    },
    [course.slug, progressPersistenceEnabled]
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
    persistActiveVideo();
    setActiveLessonId(item.id);
    setOpenSectionIds((current) =>
      current.includes(item.sectionId) ? current : [...current, item.sectionId]
    );
    setIsCurriculumOpen(false);
  };

  const returnToMyClass = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    persistActiveVideo();
    await saveChainRef.current.catch(() => undefined);
    window.location.assign("/my");
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

  const handleVideoProgress = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
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

  const handleVideoEnded = (event: SyntheticEvent<HTMLVideoElement>) => {
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
      event.currentTarget.duration,
      event.currentTarget.duration,
      isAutoCompletionSuppressed ? "preserve" : "complete"
    );
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link
            href="/my"
            prefetch={false}
            className={styles.backLink}
            onClick={returnToMyClass}
          >
            <BackIcon />
            <span>마이 클래스</span>
          </Link>

          <Link href="/" className={`serif ${styles.brand}`} aria-label="이윰 클래스 홈">
            이윰 클래스
          </Link>

          <div className={styles.headerProgress}>
            <span className={styles.userName}>{displayName}님</span>
            <span className={styles.progressCopy}>
              <strong>{formatProgressPercent(progress)}%</strong> · {completedCount} / {flatLessons.length}강
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
            {activeLesson.videoSrc ? (
              <video
                key={activeLesson.id}
                ref={videoRef}
                className={styles.video}
                src={activeLesson.videoSrc}
                poster={course.posterSrc}
                controls
                playsInline
                preload="metadata"
                aria-label={`${activeLesson.title} 강의 영상`}
                onTimeUpdate={handleVideoProgress}
                onPause={() => persistActiveVideo()}
                onEnded={handleVideoEnded}
              />
            ) : (
              <>
                <Image
                  src={course.posterSrc}
                  alt=""
                  fill
                  loading="eager"
                  fetchPriority="high"
                  sizes="(max-width: 920px) 100vw, 70vw"
                  className={styles.poster}
                />
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
            <p>{course.instructor} · {flatLessons.length}강</p>
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
                        {sectionCompletedCount}/{section.lessons.length}강 완료
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
                        const isActive = item.id === activeLesson.id;
                        const isComplete = completedLessonIds.includes(item.id);
                        const lessonProgress = calculateLessonProgressPercent(
                          item.durationSeconds,
                          positionsByLessonId[item.id] ?? 0,
                          isComplete
                        );
                        const lessonProgressLabel = isComplete
                          ? "학습 완료"
                          : lessonProgress > 0
                            ? `${lessonProgress}% 시청`
                            : "미완료";

                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              className={isActive ? styles.lessonRowActive : styles.lessonRow}
                              aria-current={isActive ? "step" : undefined}
                              aria-label={`${itemGlobalIndex + 1}강 ${item.title}, ${lessonProgressLabel}`}
                              onClick={() => openLesson(flatItem)}
                            >
                              <span className={isComplete ? styles.lessonCheckDone : styles.lessonCheck}>
                                {isComplete ? <CheckIcon /> : String(itemGlobalIndex + 1).padStart(2, "0")}
                              </span>
                              <span className={styles.lessonRowCopy}>
                                <strong>{item.title}</strong>
                                <small>
                                  {formatDuration(item.durationSeconds)} · {isComplete
                                    ? "완료"
                                    : lessonProgress > 0
                                      ? `${lessonProgress}% 시청`
                                      : item.videoSrc
                                        ? "재생 가능"
                                      : "미완료"}
                                </small>
                              </span>
                              {isActive && <span className={styles.nowPlaying}>재생 중</span>}
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
