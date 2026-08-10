"use client";

import { useState } from "react";
import { loadDeletedLessonWatchersAction } from "@/app/admin/progress/deleted-lesson-actions";
import type {
  DeletedLessonRecord,
  DeletedLessonWatcher,
} from "@/lib/admin/deleted-lessons";
import { describeWatchProgress } from "@/lib/admin/watch-progress";
import { ChevronIcon } from "./icons";
import styles from "./AdminDeletedLessons.module.css";

type Props = {
  records: DeletedLessonRecord[];
  databaseReady: boolean;
  sourceMessage: string | null;
};

/**
 * 삭제된 차시와 그 차시에 남아 있는 수강 기록.
 *
 * 차시를 지워도 수강 기록은 지워지지 않는다. 다만 진도 화면이 현재 차시 목록을
 * 기준으로 만들어져서 화면에서만 사라진다. 환불 분쟁에서 "얼마나 봤는가"를 대야 할
 * 때 찾을 곳이 여기다.
 */
export default function AdminDeletedLessons({
  records,
  databaseReady,
  sourceMessage,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [watchers, setWatchers] = useState<Record<string, DeletedLessonWatcher[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const toggle = async (recordId: string) => {
    if (expandedId === recordId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(recordId);

    // 한 번 읽은 기록은 다시 읽지 않는다.
    if (watchers[recordId]) return;

    setLoadingId(recordId);
    try {
      const rows = await loadDeletedLessonWatchersAction(recordId);
      setWatchers((previous) => ({ ...previous, [recordId]: rows }));
    } finally {
      setLoadingId(null);
    }
  };

  if (!databaseReady) {
    return (
      <section className={styles.panel} aria-labelledby="deleted-lessons-heading">
        <Header />
        <p className={styles.notice}>{sourceMessage}</p>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="deleted-lessons-heading">
      <Header />

      {sourceMessage && <p className={styles.notice}>{sourceMessage}</p>}

      {records.length === 0 ? (
        <p className={styles.empty}>완전 삭제한 차시가 아직 없습니다.</p>
      ) : (
        <ul className={styles.list}>
          {records.map((record) => {
            const isOpen = expandedId === record.id;
            const rows = watchers[record.id];

            return (
              <li key={record.id} className={styles.item}>
                <button
                  type="button"
                  className={styles.summary}
                  onClick={() => toggle(record.id)}
                  aria-expanded={isOpen}
                >
                  <span className={styles.titles}>
                    <span className={styles.lessonTitle}>{record.lessonTitle}</span>
                    <span className={styles.meta}>
                      {record.courseTitle}
                      {record.sectionTitle ? ` · ${record.sectionTitle}` : ""}
                    </span>
                  </span>

                  <span className={styles.stats}>
                    <span className={styles.stat}>
                      <strong>{record.recordCount}</strong>명 기록
                    </span>
                    <span className={styles.stat}>
                      완강 <strong>{record.completedCount}</strong>명
                    </span>
                    <span className={styles.deletedAt}>
                      {formatDate(record.deletedAt)} 삭제
                    </span>
                  </span>

                  <span className={isOpen ? styles.chevronOpen : styles.chevron}>
                    <ChevronIcon />
                  </span>
                </button>

                {isOpen && (
                  <div className={styles.detail}>
                    {loadingId === record.id && !rows ? (
                      <p className={styles.detailNotice}>기록을 불러오는 중입니다…</p>
                    ) : !rows || rows.length === 0 ? (
                      <p className={styles.detailNotice}>
                        남아 있는 수강 기록이 없습니다.
                      </p>
                    ) : (
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th scope="col">회원</th>
                            <th scope="col">시청</th>
                            <th scope="col">완강</th>
                            <th scope="col">마지막 시청</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((watcher) => (
                            <tr key={watcher.memberId}>
                              <td>
                                <span className={styles.memberName}>
                                  {watcher.memberName}
                                </span>
                                <span className={styles.memberEmail}>
                                  {watcher.memberEmail}
                                </span>
                              </td>
                              <td>{describeWatchProgress(watcher.maxPositionSeconds, watcher.durationSeconds)}</td>
                              <td>
                                {watcher.firstCompletedAt
                                  ? formatDate(watcher.firstCompletedAt)
                                  : "—"}
                              </td>
                              <td>
                                {watcher.lastWatchedAt
                                  ? formatDate(watcher.lastWatchedAt)
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Header() {
  return (
    <header className={styles.header}>
      <p className={styles.eyebrow}>DELETED LESSONS</p>
      <h2 id="deleted-lessons-heading" className={styles.heading}>
        삭제된 차시 기록
      </h2>
      <p className={styles.description}>
        완전 삭제한 차시입니다. 차시는 사라졌지만 수강 기록은 남아 있어, 환불 문의가
        들어오면 여기서 누가 얼마나 봤는지 확인할 수 있습니다.
      </p>
    </header>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
