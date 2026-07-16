"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import styles from "@/app/my/my.module.css";
import type { CourseLibraryItem, LibraryItem } from "@/lib/my-class/types";

type Filter = "all" | "course" | "ebook" | "completed";

const filters: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "전체" },
  { id: "course", label: "VOD 강의" },
  { id: "ebook", label: "전자책" },
  { id: "completed", label: "완료" },
];

export default function MyClassLibrary({
  displayName,
  items,
}: {
  displayName: string;
  items: LibraryItem[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [notice, setNotice] = useState("");

  const course = items
    .filter(
      (item): item is CourseLibraryItem =>
        item.kind === "course" && item.status !== "preparing"
    )
    .sort((a, b) =>
      (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "")
    )[0];
  const visibleItems = (() => {
    if (filter === "all") return items;
    if (filter === "completed") {
      return items.filter((item) => item.status === "completed");
    }
    return items.filter((item) => item.kind === filter);
  })();

  const completedCount = items.filter((item) => item.status === "completed").length;
  const inProgressCount = items.filter((item) => item.status === "in-progress").length;

  const handleEbookAction = () => {
    setNotice("전자책 파일 또는 리더가 연결되면 이 자리에서 바로 열립니다.");
  };

  return (
    <>
      <section className={styles.intro} aria-labelledby="my-class-title">
        <div>
          <span className={styles.eyebrow}>MY CLASS</span>
          <h1 id="my-class-title" className={`serif ${styles.pageTitle}`}>
            {displayName}님,
            <br />
            이어서 배워볼까요?
          </h1>
        </div>
        <p className={styles.introCopy}>
          보유한 강의와 전자책을 한곳에서 확인하고,
          <br className={styles.desktopBreak} /> 마지막으로 학습한 지점부터 이어갈 수 있어요.
        </p>
      </section>

      {course && (
        <section className={styles.continueSection} aria-labelledby="continue-title">
          <article className={styles.continueCard}>
            <div className={styles.continueBody}>
              <div className={styles.continueTopline}>
                <span className={styles.continueLabel}>
                  {course.status === "not-started" ? "학습 시작하기" : "이어서 학습하기"}
                </span>
                <span className={styles.darkStatus}>{course.statusLabel}</span>
              </div>

              <h2 id="continue-title" className={`serif ${styles.continueTitle}`}>
                {course.title}
              </h2>
              <p className={styles.currentLesson}>
                <span>{course.status === "not-started" ? "첫 학습" : "현재 학습"}</span>
                {course.currentLessonLabel}
                {course.status !== "not-started" && (
                  <strong>{course.currentLessonProgress}% 시청</strong>
                )}
              </p>

              <div className={styles.progressBlock}>
                <div className={styles.progressMeta}>
                  <span>
                    {course.completedLessons}강 완료 / 총 {course.totalLessons}강
                  </span>
                  <strong>{formatProgressPercent(course.progress)}%</strong>
                </div>
                <div
                  className={styles.progressTrackDark}
                  role="progressbar"
                  aria-label={`${course.title} 수강 진도`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={course.progress}
                >
                  <span style={{ width: `${course.progress}%` }} />
                </div>
              </div>

              <div className={styles.lessonTrail} aria-label="최근 학습한 차시">
                {course.recentCompletedLessonLabel && (
                  <span className={styles.lessonDone}>
                    <CheckIcon /> {course.recentCompletedLessonLabel}
                  </span>
                )}
                <span className={styles.lessonCurrent}>
                  <PlayIcon /> {course.currentLessonLabel}
                </span>
              </div>

              <Link href={course.href} className={styles.continueButton}>
                {course.status === "not-started" ? "강의 시작하기" : course.ctaLabel} <ArrowIcon />
              </Link>
            </div>

            <div className={styles.continueArtwork} aria-hidden="true">
              <Image
                src="/assets/profile.jpg"
                alt=""
                fill
                loading="eager"
                fetchPriority="high"
                sizes="(max-width: 760px) 100vw, 38vw"
                className={styles.continueImage}
              />
              <div className={styles.artworkCaption}>
                <span>YIYUM CLASS</span>
                <strong>{course.totalLessons} LESSONS</strong>
              </div>
            </div>
          </article>
        </section>
      )}

      <section className={styles.summary} aria-label="내 콘텐츠 요약">
        <SummaryItem label="보유 콘텐츠" value={items.length} suffix="개" />
        <SummaryItem label="수강 중" value={inProgressCount} suffix="개" />
        <SummaryItem label="완료" value={completedCount} suffix="개" />
      </section>

      <section className={styles.librarySection} aria-labelledby="library-title">
        <div className={styles.libraryHeader}>
          <div>
            <span className={styles.sectionNumber}>01</span>
            <h2 id="library-title" className={`serif ${styles.sectionTitle}`}>
              나의 콘텐츠
            </h2>
          </div>

          <div className={styles.tabs} aria-label="콘텐츠 유형 필터">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={filter === item.id}
                className={filter === item.id ? styles.tabActive : styles.tab}
                onClick={() => {
                  setFilter(item.id);
                  setNotice("");
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {visibleItems.length > 0 ? (
          <div className={styles.contentGrid}>
            {visibleItems.map((item) => (
              <ContentCard
                key={item.id}
                item={item}
                onAction={handleEbookAction}
              />
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <span className={styles.emptyMark}>✓</span>
            <h3 className="serif">아직 완료한 콘텐츠가 없어요</h3>
            <p>조금씩 이어가다 보면 이곳에 완주한 클래스가 차곡차곡 모여요.</p>
            <button type="button" onClick={() => setFilter("all")}>
              전체 콘텐츠 보기
            </button>
          </div>
        )}

        <p className={styles.actionNotice} role="status" aria-live="polite">
          {notice}
        </p>
      </section>
    </>
  );
}

function SummaryItem({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <div className={styles.summaryItem}>
      <span>{label}</span>
      <strong className="serif">
        {value}
        <small>{suffix}</small>
      </strong>
    </div>
  );
}

function ContentCard({ item, onAction }: { item: LibraryItem; onAction: () => void }) {
  const isCourse = item.kind === "course";

  return (
    <article className={styles.contentCard}>
      <div className={isCourse ? styles.courseVisual : styles.ebookVisual}>
        {isCourse ? (
          <>
            <Image
              src="/assets/profile.jpg"
              alt={item.title}
              fill
              sizes="(max-width: 760px) 100vw, 45vw"
              className={styles.cardImage}
            />
            <span className={styles.visualType}>VOD · {item.totalLessons}강</span>
          </>
        ) : (
          <div className={styles.bookCover} aria-label="전자책 표지">
            <span>YIYUM NOTE · 01</span>
            <strong className="serif">
              작은 계정을
              <br />수익으로 연결하는 법
            </strong>
            <i>Digital workbook</i>
          </div>
        )}
      </div>

      <div className={styles.cardBody}>
        <div className={styles.cardTopline}>
          <span className={styles.kindLabel}>{isCourse ? "VOD 강의" : "전자책"}</span>
          <span className={styles.statusBadge}>{item.statusLabel}</span>
        </div>

        <h3 className={`serif ${styles.cardTitle}`}>{item.title}</h3>
        <p className={styles.cardDescription}>{item.description}</p>

        {isCourse && item.status === "preparing" ? (
          <div className={styles.preparingMeta}>
            <strong>수강 신청 완료</strong>
            <span>첫 공개 차시가 등록되면 바로 학습할 수 있어요.</span>
          </div>
        ) : isCourse && item.progress !== undefined ? (
          <div className={styles.cardProgress}>
            <div>
              <span>
                {item.completedLessons}/{item.totalLessons}강 완료
              </span>
              <strong>{formatProgressPercent(item.progress)}%</strong>
            </div>
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-label={`${item.title} 수강 진도`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={item.progress}
            >
              <span style={{ width: `${item.progress}%` }} />
            </div>
          </div>
        ) : (
          <div className={styles.ebookMeta}>
            <BookIcon /> PDF · 구매 후 언제든 열람
          </div>
        )}

        <dl className={styles.cardMeta}>
          <div>
            <dt>최근 이용</dt>
            <dd>{item.lastActivity}</dd>
          </div>
          <div>
            <dt>이용 기간</dt>
            <dd>{item.accessLabel}</dd>
          </div>
        </dl>

        {isCourse && item.status === "preparing" ? (
          <span className={`${styles.cardButton} ${styles.cardButtonDisabled}`} aria-disabled="true">
            {item.ctaLabel}
          </span>
        ) : isCourse ? (
          <Link href={item.href} className={styles.cardButton}>
            {item.ctaLabel} <ArrowIcon />
          </Link>
        ) : (
          <button type="button" className={styles.cardButton} onClick={onAction}>
            {item.ctaLabel} <ArrowIcon />
          </button>
        )}
      </div>
    </article>
  );
}

function formatProgressPercent(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="8" />
      <path d="m5.5 9 2.2 2.2 4.8-5" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="8" />
      <path d="m7.5 6.2 4.2 2.8-4.2 2.8Z" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.5 4.2c2.7-.5 4.8.2 6.5 1.6v10c-1.7-1.4-3.8-2.1-6.5-1.6v-10Z" />
      <path d="M16.5 4.2c-2.7-.5-4.8.2-6.5 1.6v10c1.7-1.4 3.8-2.1 6.5-1.6v-10Z" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  );
}
