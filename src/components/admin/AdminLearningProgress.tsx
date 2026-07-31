"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAdminFeedback } from "@/components/admin/AdminFeedback";
import AdminPagination, { DEFAULT_ADMIN_PAGE_SIZE } from "@/components/admin/AdminPagination";
import tableStyles from "@/components/admin/AdminTable.module.css";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChartIcon,
  ChevronIcon,
  DatabaseIcon,
  DownloadIcon,
  SearchIcon,
  SortIcon,
} from "@/components/admin/icons";
import { exportAdminLearningAction } from "@/app/admin/progress/actions";
import { exportRowsToCsv } from "@/lib/admin/csv";
import type {
  AdminLearningCourseSummary,
  AdminLearningRecord,
  AdminLearningSummary,
} from "@/lib/admin/learning-progress";
import { useTableParams } from "@/lib/admin/use-table-params";
import styles from "./AdminLearningProgress.module.css";

type AdminLearningProgressProps = {
  /** 서버가 이미 거르고 정렬해 잘라 준 한 페이지. 화면은 다시 거르지 않는다. */
  records: AdminLearningRecord[];
  totalCount: number;
  summary: AdminLearningSummary;
  courses: AdminLearningCourseSummary[];
  page: number;
  pageSize: number;
  databaseReady: boolean;
  sourceMessage: string | null;
  referenceTime: string;
};

type LearningState = "not_started" | "in_progress" | "completed";
type StatusFilter = "all" | LearningState | "attention";
type SortOption =
  | "recent"
  | "oldest"
  | "progress_low"
  | "progress_high"
  | "lesson_low"
  | "lesson_high"
  | "name";

const ATTENTION_DAYS = 14;
const ACTIVE_WINDOW_DAYS = 30;
const SEARCH_DEBOUNCE_MS = 300;

const statusFilters: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "not_started", label: "시작 전" },
  { value: "in_progress", label: "진행 중" },
  { value: "completed", label: "완료" },
  { value: "attention", label: "관심 필요" },
];

const sortOptions: Array<{ value: SortOption; label: string }> = [
  { value: "recent", label: "최근 학습순" },
  { value: "oldest", label: "오래된 학습순" },
  { value: "progress_low", label: "진도 낮은순" },
  { value: "progress_high", label: "진도 높은순" },
  { value: "lesson_low", label: "완료 차시 적은순" },
  { value: "lesson_high", label: "완료 차시 많은순" },
  { value: "name", label: "회원 이름순" },
];

// useTableParams가 defaults를 의존성으로 쓰므로 렌더마다 새 객체를 만들지 않는다.
const TABLE_DEFAULTS = {
  q: "",
  status: "all",
  course: "all",
  sort: "recent",
  page: 1,
  size: DEFAULT_ADMIN_PAGE_SIZE,
};

export default function AdminLearningProgress({
  records,
  totalCount,
  summary,
  courses,
  page,
  pageSize,
  databaseReady,
  sourceMessage,
  referenceTime,
}: AdminLearningProgressProps) {
  const referenceDate = useMemo(() => new Date(referenceTime), [referenceTime]);
  const { toast } = useAdminFeedback();
  const { values, setValues } = useTableParams(TABLE_DEFAULTS);

  const query = values.q;
  const statusFilter = parseStatusFilter(values.status);
  const courseFilter = values.course;
  const sort = parseSortOption(values.sort);

  const [searchInput, setSearchInput] = useState(query);
  const [exporting, setExporting] = useState(false);

  // 타이핑마다 router.replace가 돌면 목록 전체가 다시 정렬된다.
  useEffect(() => {
    if (searchInput === query) return;
    const timer = window.setTimeout(() => setValues({ q: searchInput }), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, searchInput, setValues]);

  const filtersActive = query.trim() !== "" || statusFilter !== "all" || courseFilter !== "all";

  // 화면에는 한 페이지밖에 없다. 필터에 걸린 전체는 서버가 다시 읽어 준다.
  const handleExport = async () => {
    setExporting(true);
    try {
      const { rows, truncated } = await exportAdminLearningAction({
        search: query,
        status: statusFilter,
        courseId: courseFilter === "all" ? null : courseFilter,
        sort,
      });

      exportRowsToCsv({
        fileName: "이윰-학습현황",
        columns: [
          { header: "회원명", value: (record) => record.memberName },
          { header: "이메일", value: (record) => record.memberEmail },
          { header: "강의명", value: (record) => record.courseTitle },
          { header: "강의slug", value: (record) => record.courseSlug },
          { header: "진도율", value: (record) => record.progressPercent },
          { header: "완료차시", value: (record) => record.completedLessons },
          { header: "전체차시", value: (record) => record.totalLessons },
          { header: "시작차시", value: (record) => record.startedLessons },
          { header: "학습시간(분)", value: (record) => Math.floor(record.watchedSeconds / 60) },
          { header: "최근학습일", value: (record) => formatCsvDate(record.lastWatchedAt) },
          {
            header: "최근차시",
            value: (record) => record.lastLessonTitle ?? record.lastLessonKey ?? "",
          },
          {
            header: "학습상태",
            value: (record) => formatRecordStatus(record, referenceDate),
          },
        ],
        rows,
      });

      if (truncated) {
        toast("상한 5000행까지만 내보냈습니다.", "error");
      } else {
        toast(`${formatNumber(rows.length)}건을 내보냈습니다.`, "success");
      }
    } catch {
      toast("CSV를 내보내지 못했습니다. 잠시 후 다시 시도해 주세요.", "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>LEARNING ANALYTICS</p>
          <h1>현재 학습 진도</h1>
          <p>회원과 강의별 현재 진도, 최근 학습과 완료 상태를 확인합니다.</p>
        </div>
        <span className={databaseReady ? styles.liveBadge : styles.pendingBadge}>
          <span aria-hidden="true" />
          {databaseReady ? "현재 진도" : "설정 필요"}
        </span>
      </section>

      {!databaseReady && (
        <div className={styles.setupNotice} role="status">
          <DatabaseIcon />
          <div>
            <strong>현재 학습 진도를 아직 불러올 수 없습니다.</strong>
            <p>{sourceMessage}</p>
          </div>
        </div>
      )}

      <section className={styles.summarySection} aria-label="현재 학습 진도 요약">
        {filtersActive && (
          <p className={styles.summaryScope}>
            (필터 적용됨) 아래 수치는 현재 조건에 걸린 결과 기준입니다. &lsquo;관심 필요&rsquo;만 전체 기준입니다.
          </p>
        )}
        <div className={styles.summaryBar}>
          <SummaryItem
            label="수강 회원"
            hint="조건에 걸린 수강권의 회원 수"
            value={formatNumber(summary.memberCount)}
            unit="명"
          />
          <SummaryItem
            label="최근 30일 학습"
            hint={`오늘부터 ${ACTIVE_WINDOW_DAYS}일 안에 학습 기록이 있는 회원`}
            value={formatNumber(summary.activeMemberCount)}
            unit="명"
            tone="active"
          />
          <SummaryItem
            label="평균 현재 진도"
            hint="조건에 걸린 수강권의 진도 평균"
            value={formatPercent(summary.averageProgress)}
            tone="progress"
          />
          <SummaryItem
            label="관심 필요 (전체 기준)"
            hint={`마지막 학습 후 ${ATTENTION_DAYS}일 경과 또는 미시작`}
            value={formatNumber(summary.attentionTotal)}
            unit="건"
            tone="warning"
          />
        </div>
      </section>

      {courses.length > 0 && (
        <section className={styles.courseSection} aria-labelledby="course-summary-title">
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="course-summary-title">강의별 현재 진도</h2>
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
                onClick={() => setValues({ course: courseFilter === course.id ? "all" : course.id })}
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
                  <span className={course.attention > 0 ? styles.courseAttention : undefined}>
                    관심 필요 <strong>{course.attention}</strong>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className={styles.progressPanel} aria-labelledby="learner-progress-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="learner-progress-title">회원별 현재 진도</h2>
            <p>장기 미학습은 마지막 학습 후 {ATTENTION_DAYS}일이 지났거나 아직 시작하지 않은 경우입니다. 환불 판단용 수강 기록은 주문·결제에서 확인합니다.</p>
          </div>
          <div className={styles.panelActions}>
            <span className={styles.resultCount}>총 {formatNumber(totalCount)}건</span>
            <button
              type="button"
              className={styles.exportButton}
              onClick={handleExport}
              disabled={totalCount === 0 || exporting}
            >
              <DownloadIcon />
              {exporting ? "내보내는 중…" : "CSV 내보내기"}
            </button>
          </div>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.statusFilters} aria-label="학습 상태 필터">
            {statusFilters.map((filter) => (
              <button
                type="button"
                key={filter.value}
                className={statusFilter === filter.value ? styles.filterActive : styles.filter}
                onClick={() => setValues({ status: filter.value })}
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
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="회원 또는 강의 검색"
              />
            </label>
            <SelectField
              label="강의 선택"
              value={courseFilter}
              onChange={(value) => setValues({ course: value })}
              options={[
                { value: "all", label: "모든 강의" },
                ...courses.map((course) => ({ value: course.id, label: course.title })),
              ]}
            />
            <SelectField
              label="정렬"
              value={sort}
              onChange={(value) => setValues({ sort: value })}
              options={sortOptions}
            />
          </div>
        </div>

        {records.length > 0 ? (
          <>
            <div className={styles.tableWrap}>
              <table className={`${styles.progressTable} ${tableStyles.cardTable}`}>
                <thead>
                  <tr>
                    <th scope="col">회원</th>
                    <th scope="col">강의</th>
                    <SortableHeader
                      label="현재 진도"
                      ascending="progress_low"
                      descending="progress_high"
                      sort={sort}
                      onSort={(next) => setValues({ sort: next })}
                    />
                    <SortableHeader
                      label="완료 차시"
                      ascending="lesson_low"
                      descending="lesson_high"
                      sort={sort}
                      onSort={(next) => setValues({ sort: next })}
                    />
                    <SortableHeader
                      label="최근 학습"
                      ascending="oldest"
                      descending="recent"
                      sort={sort}
                      onSort={(next) => setValues({ sort: next })}
                    />
                    <th scope="col">학습 상태</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <ProgressRow key={`${record.entitlementId}:${record.courseId}`} record={record} referenceDate={referenceDate} />
                  ))}
                </tbody>
              </table>
            </div>
            <AdminPagination
              page={page}
              pageSize={pageSize}
              totalCount={totalCount}
              onPageChange={(next) => setValues({ page: next })}
              onPageSizeChange={(next) => setValues({ size: next, page: 1 })}
            />
          </>
        ) : (
          <div className={styles.emptyState}>
            <ChartIcon />
            <strong>{filtersActive ? "조건에 맞는 현재 학습 진도가 없습니다." : "표시할 현재 학습 진도가 없습니다."}</strong>
            <p>{filtersActive ? "검색어 또는 필터를 변경해 보세요." : "유효한 강의 수강권이 발급되면 이곳에서 진도를 확인할 수 있습니다."}</p>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryItem({ label, hint, value, unit, tone }: { label: string; hint?: string; value: string; unit?: string; tone?: "active" | "progress" | "warning" }) {
  return (
    <div className={styles.summaryItem}>
      <span className={styles.summaryLabel} title={hint}>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <strong className={tone ? styles[`summary_${tone}`] : undefined}>{value}{unit && <small>{unit}</small>}</strong>
    </div>
  );
}

function SortableHeader({
  label,
  ascending,
  descending,
  sort,
  onSort,
}: {
  label: string;
  ascending: SortOption;
  descending: SortOption;
  sort: SortOption;
  onSort: (sort: SortOption) => void;
}) {
  const direction = sort === ascending ? "ascending" : sort === descending ? "descending" : "none";
  return (
    <th scope="col" aria-sort={direction}>
      <button
        type="button"
        className={direction === "none" ? styles.sortButton : styles.sortButtonActive}
        onClick={() => onSort(direction === "descending" ? ascending : descending)}
      >
        {label}
        {direction === "ascending" ? <ArrowUpIcon /> : direction === "descending" ? <ArrowDownIcon /> : <SortIcon />}
      </button>
    </th>
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
          <span>
            <strong>{record.memberName}</strong>
            <small>{record.memberEmail}</small>
            {/* 운영자가 같은 회원을 회원·주문 화면에서 다시 찾을 때 이메일을 손으로 옮기지 않도록 한다. */}
            <span className={styles.rowLinks}>
              <Link href={`/admin/members?q=${encodeURIComponent(record.memberEmail)}`}>회원 정보</Link>
              <Link href={`/admin/orders?q=${encodeURIComponent(record.memberEmail)}`}>주문 내역</Link>
            </span>
          </span>
        </span>
      </td>
      <td data-label="강의">
        <span className={styles.courseIdentity}>
          <Link href="/admin/courses" className={styles.courseLink}>
            <strong>{record.courseTitle}</strong>
          </Link>
          <small>/{record.courseSlug}</small>
        </span>
      </td>
      <td data-label="현재 진도">
        <span className={styles.progressCell} aria-label={`현재 진도 ${formatPercent(record.progressPercent)}`}>
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

/**
 * 행의 상태 배지 표시용. 거르기·집계는 모두 SQL이 하므로 여기 판정은 화면에만 쓴다.
 * 규칙을 바꾼다면 admin_learning_progress_base의 learning_state도 함께 고쳐야 한다.
 */
function getLearningState(record: AdminLearningRecord): LearningState {
  if (record.totalLessons > 0 && record.completedLessons >= record.totalLessons) return "completed";
  if (!record.lastWatchedAt && record.startedLessons === 0) return "not_started";
  return "in_progress";
}

function needsAttention(record: AdminLearningRecord, referenceDate: Date) {
  const state = getLearningState(record);
  if (state === "completed") return false;
  if (!record.lastWatchedAt) return true;
  return !isRecent(record.lastWatchedAt, referenceDate, ATTENTION_DAYS);
}

function isRecent(value: string | null, referenceDate: Date, days: number) {
  if (!value) return false;
  return new Date(value).getTime() >= referenceDate.getTime() - days * 24 * 60 * 60 * 1000;
}

function parseStatusFilter(value: string): StatusFilter {
  return statusFilters.some((filter) => filter.value === value) ? (value as StatusFilter) : "all";
}

function parseSortOption(value: string): SortOption {
  return sortOptions.some((option) => option.value === value) ? (value as SortOption) : "recent";
}

/** 표의 상태 배지와 같은 문구를 쓴다. 내보낸 CSV와 화면이 달라 보이지 않게 한다. */
function formatRecordStatus(record: AdminLearningRecord, referenceDate: Date) {
  const state = getLearningState(record);
  return needsAttention(record, referenceDate) && state !== "completed"
    ? "관심 필요"
    : formatLearningState(state);
}

function formatLearningState(state: LearningState) { return { not_started: "시작 전", in_progress: "진행 중", completed: "완료" }[state]; }
function formatNumber(value: number) { return new Intl.NumberFormat("ko-KR").format(value); }
function formatPercent(value: number) { return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(value)}%`; }
function formatWatchTime(seconds: number) { const minutes = Math.floor(seconds / 60); return minutes < 60 ? `${minutes}분` : `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`; }
function formatCsvDate(value: string | null) { return value ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) : ""; }
function formatRelativeDate(value: string, referenceDate: Date) { const days = Math.max(0, Math.floor((referenceDate.getTime() - new Date(value).getTime()) / (24 * 60 * 60 * 1000))); if (days === 0) return "오늘"; if (days === 1) return "어제"; if (days < 30) return `${days}일 전`; return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
