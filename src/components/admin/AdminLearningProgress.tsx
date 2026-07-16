"use client";

import { useMemo, useState } from "react";
import type { AdminLearningRecord } from "@/lib/admin/learning-progress";
import styles from "./AdminLearningProgress.module.css";

type AdminLearningProgressProps = {
  records: AdminLearningRecord[];
  databaseReady: boolean;
  sourceMessage: string | null;
  referenceTime: string;
};

type LearningState = "not_started" | "in_progress" | "completed";
type StatusFilter = "all" | LearningState | "attention";
type SortOption = "recent" | "progress_low" | "progress_high" | "name";

const statusFilters: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "not_started", label: "시작 전" },
  { value: "in_progress", label: "진행 중" },
  { value: "completed", label: "완료" },
  { value: "attention", label: "관심 필요" },
];

const sortOptions: Array<{ value: SortOption; label: string }> = [
  { value: "recent", label: "최근 학습순" },
  { value: "progress_low", label: "진도 낮은순" },
  { value: "progress_high", label: "진도 높은순" },
  { value: "name", label: "회원 이름순" },
];

export default function AdminLearningProgress({
  records,
  databaseReady,
  sourceMessage,
  referenceTime,
}: AdminLearningProgressProps) {
  const referenceDate = useMemo(() => new Date(referenceTime), [referenceTime]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [courseFilter, setCourseFilter] = useState("all");
  const [sort, setSort] = useState<SortOption>("recent");
  const courses = useMemo(() => buildCourseSummaries(records, referenceDate), [records, referenceDate]);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");

    return records
      .filter((record) => {
        const state = getLearningState(record);
        const matchesQuery =
          !normalizedQuery ||
          record.memberName.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
          record.memberEmail.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
          record.courseTitle.toLocaleLowerCase("ko-KR").includes(normalizedQuery);
        const matchesStatus =
          statusFilter === "all" ||
          state === statusFilter ||
          (statusFilter === "attention" && needsAttention(record, referenceDate));
        const matchesCourse = courseFilter === "all" || record.courseId === courseFilter;
        return matchesQuery && matchesStatus && matchesCourse;
      })
      .sort((first, second) => compareRecords(first, second, sort));
  }, [courseFilter, query, records, referenceDate, sort, statusFilter]);

  const memberCount = new Set(records.map((record) => record.memberId)).size;
  const activeMemberCount = new Set(
    records
      .filter((record) => isRecent(record.lastWatchedAt, referenceDate, 30))
      .map((record) => record.memberId)
  ).size;
  const averageProgress = records.length
    ? records.reduce((total, record) => total + record.progressPercent, 0) / records.length
    : 0;
  const attentionCount = records.filter((record) => needsAttention(record, referenceDate)).length;

  return (
    <div className={styles.page}>
      <section className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>LEARNING ANALYTICS</p>
          <h1>학습 현황</h1>
          <p>회원과 강의별 진도, 최근 학습과 완료 상태를 확인합니다.</p>
        </div>
        <span className={databaseReady ? styles.liveBadge : styles.pendingBadge}>
          <span aria-hidden="true" />
          {databaseReady ? "실시간 진도" : "설정 필요"}
        </span>
      </section>

      {!databaseReady && (
        <div className={styles.setupNotice} role="status">
          <DatabaseIcon />
          <div>
            <strong>학습 현황을 아직 불러올 수 없습니다.</strong>
            <p>{sourceMessage}</p>
            <code>20260716100000_create_admin_learning_progress.sql</code>
          </div>
        </div>
      )}

      <section className={styles.summaryBar} aria-label="학습 현황 요약">
        <SummaryItem label="수강 회원" value={formatNumber(memberCount)} unit="명" />
        <SummaryItem label="최근 30일 학습" value={formatNumber(activeMemberCount)} unit="명" tone="active" />
        <SummaryItem label="평균 진도" value={formatPercent(averageProgress)} tone="progress" />
        <SummaryItem label="관심 필요" value={formatNumber(attentionCount)} unit="건" tone="warning" />
      </section>

      {courses.length > 0 && (
        <section className={styles.courseSection} aria-labelledby="course-summary-title">
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="course-summary-title">강의별 현황</h2>
              <p>유효한 수강권과 현재 공개된 차시를 기준으로 집계합니다.</p>
            </div>
            <span>{courses.length}개 강의</span>
          </div>
          <div className={styles.courseGrid}>
            {courses.map((course) => (
              <button
                type="button"
                key={course.id}
                className={courseFilter === course.id ? styles.courseCardActive : styles.courseCard}
                onClick={() => setCourseFilter(courseFilter === course.id ? "all" : course.id)}
                aria-pressed={courseFilter === course.id}
              >
                <span className={styles.courseCardTop}>
                  <strong>{course.title}</strong>
                  <span>{course.enrolled}명 수강</span>
                </span>
                <span className={styles.courseProgressTrack} aria-hidden="true">
                  <span style={{ width: `${course.averageProgress}%` }} />
                </span>
                <span className={styles.courseMetrics}>
                  <span>평균 <strong>{formatPercent(course.averageProgress)}</strong></span>
                  <span>진행 <strong>{course.inProgress}</strong></span>
                  <span>완료 <strong>{course.completed}</strong></span>
                  <span>최근 7일 <strong>{course.recent}</strong></span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className={styles.progressPanel} aria-labelledby="learner-progress-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="learner-progress-title">회원별 학습 진도</h2>
            <p>장기 미학습은 마지막 학습 후 14일이 지났거나 아직 시작하지 않은 경우입니다.</p>
          </div>
          <span className={styles.resultCount}>총 {formatNumber(filteredRecords.length)}건</span>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.statusFilters} aria-label="학습 상태 필터">
            {statusFilters.map((filter) => (
              <button
                type="button"
                key={filter.value}
                className={statusFilter === filter.value ? styles.filterActive : styles.filter}
                onClick={() => setStatusFilter(filter.value)}
                aria-pressed={statusFilter === filter.value}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className={styles.toolbarControls}>
            <label className={styles.searchField}>
              <SearchIcon />
              <span className={styles.visuallyHidden}>회원 또는 강의 검색</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="회원 또는 강의 검색"
              />
            </label>
            <SelectField
              label="강의 선택"
              value={courseFilter}
              onChange={setCourseFilter}
              options={[
                { value: "all", label: "모든 강의" },
                ...courses.map((course) => ({ value: course.id, label: course.title })),
              ]}
            />
            <SelectField
              label="정렬"
              value={sort}
              onChange={(value) => setSort(value as SortOption)}
              options={sortOptions}
            />
          </div>
        </div>

        {filteredRecords.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.progressTable}>
              <thead>
                <tr>
                  <th>회원</th>
                  <th>강의</th>
                  <th>전체 진도</th>
                  <th>완료 차시</th>
                  <th>최근 학습</th>
                  <th>학습 상태</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => (
                  <ProgressRow key={`${record.entitlementId}:${record.courseId}`} record={record} referenceDate={referenceDate} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <ChartIcon />
            <strong>{records.length === 0 ? "표시할 학습 현황이 없습니다." : "조건에 맞는 학습 현황이 없습니다."}</strong>
            <p>{records.length === 0 ? "유효한 강의 수강권이 발급되면 이곳에서 진도를 확인할 수 있습니다." : "검색어 또는 필터를 변경해 보세요."}</p>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryItem({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: "active" | "progress" | "warning" }) {
  return (
    <div className={styles.summaryItem}>
      <span>{label}</span>
      <strong className={tone ? styles[`summary_${tone}`] : undefined}>{value}{unit && <small>{unit}</small>}</strong>
    </div>
  );
}

function ProgressRow({ record, referenceDate }: { record: AdminLearningRecord; referenceDate: Date }) {
  const state = getLearningState(record);
  const attention = needsAttention(record, referenceDate);
  return (
    <tr>
      <td>
        <span className={styles.memberIdentity}>
          <span className={styles.memberAvatar} aria-hidden="true">{record.memberName.slice(0, 1).toUpperCase()}</span>
          <span><strong>{record.memberName}</strong><small>{record.memberEmail}</small></span>
        </span>
      </td>
      <td data-label="강의"><span className={styles.courseIdentity}><strong>{record.courseTitle}</strong><small>/{record.courseSlug}</small></span></td>
      <td data-label="전체 진도">
        <span className={styles.progressCell} aria-label={`전체 진도 ${formatPercent(record.progressPercent)}`}>
          <span><strong>{formatPercent(record.progressPercent)}</strong><small>{formatWatchTime(record.watchedSeconds)} 학습</small></span>
          <span className={styles.progressTrack} aria-hidden="true"><span style={{ width: `${record.progressPercent}%` }} /></span>
        </span>
      </td>
      <td data-label="완료 차시"><strong className={styles.lessonCount}>{record.completedLessons}<small> / {record.totalLessons}강</small></strong></td>
      <td data-label="최근 학습">
        {record.lastWatchedAt ? (
          <span className={styles.lastActivity}>
            <strong>{formatRelativeDate(record.lastWatchedAt, referenceDate)}</strong>
            <small>{record.lastLessonTitle ?? record.lastLessonKey ?? "차시 정보 없음"}</small>
          </span>
        ) : <span className={styles.noActivity}>학습 기록 없음</span>}
      </td>
      <td data-label="학습 상태">
        <span className={`${styles.statusBadge} ${styles[attention && state !== "completed" ? "attention" : state]}`}>
          <span aria-hidden="true" />
          {attention && state !== "completed" ? "관심 필요" : formatLearningState(state)}
        </span>
      </td>
    </tr>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <label className={styles.selectField}>
      <span className={styles.visuallyHidden}>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
      <ChevronIcon />
    </label>
  );
}

function buildCourseSummaries(records: AdminLearningRecord[], referenceDate: Date) {
  const summaries = new Map<string, { id: string; title: string; enrolled: number; inProgress: number; completed: number; recent: number; progressTotal: number }>();
  for (const record of records) {
    const summary = summaries.get(record.courseId) ?? { id: record.courseId, title: record.courseTitle, enrolled: 0, inProgress: 0, completed: 0, recent: 0, progressTotal: 0 };
    summary.enrolled += 1;
    summary.progressTotal += record.progressPercent;
    if (getLearningState(record) === "in_progress") summary.inProgress += 1;
    if (getLearningState(record) === "completed") summary.completed += 1;
    if (isRecent(record.lastWatchedAt, referenceDate, 7)) summary.recent += 1;
    summaries.set(record.courseId, summary);
  }
  return Array.from(summaries.values()).map((summary) => ({ ...summary, averageProgress: summary.enrolled ? summary.progressTotal / summary.enrolled : 0 }));
}

function getLearningState(record: AdminLearningRecord): LearningState {
  if (record.totalLessons > 0 && record.completedLessons >= record.totalLessons) return "completed";
  if (!record.lastWatchedAt && record.startedLessons === 0) return "not_started";
  return "in_progress";
}

function needsAttention(record: AdminLearningRecord, referenceDate: Date) {
  const state = getLearningState(record);
  if (state === "completed") return false;
  if (!record.lastWatchedAt) return true;
  return !isRecent(record.lastWatchedAt, referenceDate, 14);
}

function isRecent(value: string | null, referenceDate: Date, days: number) {
  if (!value) return false;
  return new Date(value).getTime() >= referenceDate.getTime() - days * 24 * 60 * 60 * 1000;
}

function compareRecords(first: AdminLearningRecord, second: AdminLearningRecord, sort: SortOption) {
  if (sort === "progress_low") return first.progressPercent - second.progressPercent;
  if (sort === "progress_high") return second.progressPercent - first.progressPercent;
  if (sort === "name") return first.memberName.localeCompare(second.memberName, "ko-KR");
  return (second.lastWatchedAt ? new Date(second.lastWatchedAt).getTime() : 0) - (first.lastWatchedAt ? new Date(first.lastWatchedAt).getTime() : 0);
}

function formatLearningState(state: LearningState) { return { not_started: "시작 전", in_progress: "진행 중", completed: "완료" }[state]; }
function formatNumber(value: number) { return new Intl.NumberFormat("ko-KR").format(value); }
function formatPercent(value: number) { return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(value)}%`; }
function formatWatchTime(seconds: number) { const minutes = Math.floor(seconds / 60); return minutes < 60 ? `${minutes}분` : `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`; }
function formatRelativeDate(value: string, referenceDate: Date) { const days = Math.max(0, Math.floor((referenceDate.getTime() - new Date(value).getTime()) / (24 * 60 * 60 * 1000))); if (days === 0) return "오늘"; if (days === 1) return "어제"; if (days < 30) return `${days}일 전`; return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }

function SearchIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="m12.2 12.2 4 4" /></svg>; }
function ChevronIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>; }
function ChartIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20V7" /></svg>; }
function DatabaseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></svg>; }
