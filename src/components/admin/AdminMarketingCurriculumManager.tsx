"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { saveMarketingCurriculumAction } from "@/app/admin/curriculum/actions";
import {
  MAX_MARKETING_CHAPTERS,
  MAX_MARKETING_ITEMS,
  MAX_MARKETING_ITEMS_PER_CHAPTER,
  countMarketingLessons,
  type MarketingCurriculum,
  type MarketingCurriculumChapter,
  type MarketingCurriculumItem,
} from "@/lib/store/marketing-curriculum-types";
import { validateMarketingCurriculum } from "@/lib/store/marketing-curriculum-validation";
import { useAdminFeedback } from "./AdminFeedback";
import { ArrowDownIcon, ArrowUpIcon, ChevronIcon, PlusIcon } from "./icons";
import styles from "./AdminMarketingCurriculumManager.module.css";

type AdminMarketingCurriculumManagerProps = {
  initialResult: {
    curriculum: MarketingCurriculum;
    editable: boolean;
    message: string;
  };
};

type SaveFailure = {
  code: "invalid" | "stale" | "unavailable" | "forbidden" | "error";
  message: string;
};

function moveEntry<Entry>(entries: Entry[], index: number, direction: -1 | 1): Entry[] {
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= entries.length) return entries;
  const moved = [...entries];
  [moved[index], moved[destination]] = [moved[destination], moved[index]];
  return moved;
}

function nextLessonNumber(chapters: MarketingCurriculumChapter[]) {
  const numbers = new Set(chapters.flatMap((chapter) => chapter.items.map((item) => item.lessonNumber)));
  const maximum = Math.max(0, ...Array.from(numbers).filter((lessonNumber): lessonNumber is number => lessonNumber !== null && Number.isInteger(lessonNumber) && lessonNumber > 0 && lessonNumber <= 999));
  if (maximum < 999) return maximum + 1;
  for (let candidate = 1; candidate <= 999; candidate += 1) {
    if (!numbers.has(candidate)) return candidate;
  }
  return null;
}

export default function AdminMarketingCurriculumManager({
  initialResult,
}: AdminMarketingCurriculumManagerProps) {
  const { curriculum, editable, message } = initialResult;
  const { toast, confirm } = useAdminFeedback();
  const [chapters, setChapters] = useState(curriculum.chapters);
  const [savedChapters, setSavedChapters] = useState(curriculum.chapters);
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(() => new Set());
  const [version, setVersion] = useState(curriculum.version);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [busy, setBusy] = useState<"saving" | "confirming" | "reloading" | null>(null);
  const [isPending, startTransition] = useTransition();
  const busyLock = useRef(false);
  const allowReload = useRef(false);
  const dirty = JSON.stringify(chapters) !== JSON.stringify(savedChapters);
  const validation = useMemo(() => validateMarketingCurriculum(chapters), [chapters]);
  const items = chapters.flatMap((chapter) => chapter.items);
  const numberedCount = countMarketingLessons(chapters);
  const assignmentCount = items.filter((item) => item.kind === "assignment").length;
  const writeBlocked = failure?.code === "unavailable" || failure?.code === "forbidden";
  const canEdit = editable && curriculum.source === "database" && version !== null && !writeBlocked;
  const locked = busy !== null || isPending;
  const stale = failure?.code === "stale";
  const validationMessage = dirty && !validation.ok ? validation.message : null;
  const canSave = canEdit && dirty && validation.ok && !stale && !locked;

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (allowReload.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  function updateChapters(nextChapters: MarketingCurriculumChapter[]) {
    if (!canEdit || busyLock.current) return;
    setChapters(nextChapters);
    setFailure((current) => current?.code === "invalid" || current?.code === "error" ? null : current);
  }

  function updateChapter(chapterKey: string, patch: Partial<MarketingCurriculumChapter>) {
    updateChapters(chapters.map((chapter) => chapter.key === chapterKey ? { ...chapter, ...patch } : chapter));
  }

  function updateItem(chapterKey: string, itemKey: string, patch: Partial<MarketingCurriculumItem>) {
    updateChapters(chapters.map((chapter) => chapter.key === chapterKey ? {
      ...chapter,
      items: chapter.items.map((item) => item.key === itemKey ? { ...item, ...patch } : item),
    } : chapter));
  }

  function addChapter() {
    if (!canEdit || busyLock.current || chapters.length >= MAX_MARKETING_CHAPTERS) return;
    const key = `chapter-${crypto.randomUUID()}`;
    updateChapters([...chapters, {
      key,
      title: "새 챕터",
      items: [],
    }]);
    setExpandedChapters((current) => new Set(current).add(key));
  }

  function toggleChapter(key: string, open: boolean) {
    setExpandedChapters((current) => {
      if (current.has(key) === open) return current;
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function addItem(chapter: MarketingCurriculumChapter, kind: MarketingCurriculumItem["kind"]) {
    if (!canEdit || busyLock.current || items.length >= MAX_MARKETING_ITEMS || chapter.items.length >= MAX_MARKETING_ITEMS_PER_CHAPTER) return;
    updateChapter(chapter.key, { items: [...chapter.items, {
      key: `item-${crypto.randomUUID()}`,
      title: "",
      kind,
      lessonNumber: kind === "lesson" ? nextLessonNumber(chapters) : null,
    }] });
  }

  async function confirmChange(request: Parameters<typeof confirm>[0], change: () => void) {
    if (!canEdit || busyLock.current) return;
    busyLock.current = true;
    setBusy("confirming");
    try {
      if (await confirm(request)) {
        change();
        setFailure((current) => current?.code === "invalid" || current?.code === "error" ? null : current);
      }
    } finally {
      busyLock.current = false;
      setBusy(null);
    }
  }

  async function reloadLatest() {
    if (busyLock.current) return;
    busyLock.current = true;
    setBusy("confirming");
    try {
      const confirmed = await confirm({
        title: "최신 내용을 다시 불러올까요?",
        description: dirty
          ? "저장하지 않은 편집 내용이 모두 사라집니다. 서버에 마지막으로 저장된 내용으로 다시 시작합니다."
          : "서버에 마지막으로 저장된 공개 커리큘럼을 다시 불러옵니다.",
        confirmLabel: "최신 내용 다시 불러오기",
        tone: dirty ? "danger" : "default",
      });
      if (confirmed) {
        allowReload.current = true;
        setBusy("reloading");
        window.location.reload();
      }
    } finally {
      if (!allowReload.current) {
        busyLock.current = false;
        setBusy(null);
      }
    }
  }

  function saveAll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || busyLock.current || !dirty || stale || version === null) return;
    const checked = validateMarketingCurriculum(chapters);
    if (!checked.ok) {
      setFailure({ code: "invalid", message: checked.message });
      toast(checked.message, "error");
      return;
    }
    const expectedVersion = version;
    busyLock.current = true;
    setBusy("saving");
    setFailure(null);
    startTransition(async () => {
      try {
        const result = await saveMarketingCurriculumAction({
          key: curriculum.key,
          expectedVersion,
          chapters: checked.chapters,
        });
        if (!result.ok) {
          setFailure(result);
          toast(result.message, "error");
          return;
        }
        setChapters(checked.chapters);
        setSavedChapters(checked.chapters);
        setVersion(result.version);
        toast(result.message, "success");
      } catch {
        const errorMessage = "저장 결과를 확인하지 못했습니다. 편집 내용은 유지됩니다. 다시 저장하거나 최신 내용을 불러와 확인해 주세요.";
        setFailure({ code: "error", message: errorMessage });
        toast(errorMessage, "error");
      } finally {
        busyLock.current = false;
        setBusy(null);
      }
    });
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>홈페이지 콘텐츠</p>
          <h1>공개 커리큘럼</h1>
          <p className={styles.description}>홈페이지에 소개할 챕터와 강의·과제를 관리합니다. 실제 강의실의 강의, 영상, 수강 기록에는 영향을 주지 않습니다.</p>
        </div>
        <Link href="/" target="_blank" rel="noopener noreferrer" className={styles.previewLink}>공개 페이지 보기<span className={styles.srOnly}> (새 탭)</span></Link>
      </header>

      {!canEdit && (
        <div className={styles.notice} role="status">
          <strong>{curriculum.source === "seed" ? "기본 커리큘럼 · 읽기 전용" : "현재 읽기 전용입니다"}</strong>
          <p>{writeBlocked ? failure.message : message || "공개 커리큘럼 저장 설정이 완료되면 편집할 수 있습니다."}</p>
          <p>현재 내용은 확인할 수 있으며 편집과 저장은 비활성화되어 있습니다.</p>
        </div>
      )}
      {canEdit && message && <p className={styles.sourceMessage}>{message}</p>}

      <dl className={styles.summary}>
        <div><dt>챕터</dt><dd>{chapters.length}<small> / {MAX_MARKETING_CHAPTERS}</small></dd></div>
        <div><dt>전체 항목</dt><dd>{items.length}<small> / {MAX_MARKETING_ITEMS}</small></dd></div>
        <div><dt>번호 있는 차시</dt><dd>{numberedCount}<small>개</small></dd></div>
        <div><dt>과제</dt><dd>{assignmentCount}<small>개</small></dd></div>
      </dl>

      <form onSubmit={saveAll} noValidate aria-busy={locked}>
        <div className={styles.editorHeading}>
          <div>
            <h2>챕터 구성</h2>
            <p id="curriculum-number-help">챕터 제목을 클릭하면 펼치거나 접을 수 있습니다. 펼친 뒤 위·아래 버튼으로 순서를 바꿉니다. 차시 번호는 전체 챕터 기준이며 순서를 바꿔도 유지됩니다. 번호가 있는 과제도 차시 수에 포함됩니다.</p>
          </div>
          <button type="button" className={styles.secondaryButton} disabled={!canEdit || locked || chapters.length >= MAX_MARKETING_CHAPTERS} onClick={addChapter}><PlusIcon />챕터 추가</button>
        </div>

        {failure && (
          <div className={styles.errorNotice} role="alert">
            <strong>{stale ? "다른 관리자가 먼저 저장했습니다" : "저장하지 못했습니다"}</strong>
            <p>{failure.message}</p>
            {stale && <p>지금 편집한 내용은 유지됩니다. 최신 내용을 다시 불러오면 저장하지 않은 편집 내용이 사라집니다.</p>}
          </div>
        )}
        {validationMessage && <p id="curriculum-validation" className={styles.validation} role="alert">{validationMessage}</p>}

        <fieldset className={styles.editor} disabled={!canEdit || locked} aria-describedby={validationMessage ? "curriculum-number-help curriculum-validation" : "curriculum-number-help"}>
          <legend className={styles.srOnly}>공개 커리큘럼 편집</legend>
          {chapters.length === 0 && <div className={styles.empty}><strong>등록된 챕터가 없습니다</strong><p>챕터를 추가하고 소개할 강의와 과제를 구성해 주세요.</p></div>}
          <ol className={styles.chapterList}>
            {chapters.map((chapter, chapterIndex) => {
              const chapterLabel = `${chapterIndex + 1}번째 챕터`;
              const atItemLimit = chapter.items.length >= MAX_MARKETING_ITEMS_PER_CHAPTER || items.length >= MAX_MARKETING_ITEMS;
              return (
                <li key={chapter.key} className={styles.chapter}>
                  <details open={expandedChapters.has(chapter.key)} onToggle={(event) => toggleChapter(chapter.key, event.currentTarget.open)}>
                    <summary className={styles.chapterToggle}>
                      <span className={styles.chapterOverview}>
                        <span className={styles.chapterNumber}>Chapter {chapterIndex + 1}</span>
                        <strong>{chapter.title || "제목 없는 챕터"}</strong>
                        <span className={styles.chapterCount}>항목 {chapter.items.length}개 · 번호 있는 차시 {countMarketingLessons([chapter])}개</span>
                      </span>
                      <ChevronIcon className={styles.chapterChevron} />
                    </summary>
                    <div className={styles.chapterHeader}>
                      <div className={styles.chapterTitle}>
                        <label htmlFor={`chapter-title-${chapter.key}`}>{chapterLabel} 제목</label>
                        <input id={`chapter-title-${chapter.key}`} type="text" value={chapter.title} placeholder="챕터 제목을 입력하세요" onChange={(event) => updateChapter(chapter.key, { title: event.target.value })} />
                      </div>
                      <div className={styles.rowActions}>
                        <button type="button" className={styles.iconButton} aria-label={`${chapterLabel} 위로 이동`} disabled={chapterIndex === 0} onClick={() => updateChapters(moveEntry(chapters, chapterIndex, -1))}><ArrowUpIcon /></button>
                        <button type="button" className={styles.iconButton} aria-label={`${chapterLabel} 아래로 이동`} disabled={chapterIndex === chapters.length - 1} onClick={() => updateChapters(moveEntry(chapters, chapterIndex, 1))}><ArrowDownIcon /></button>
                        <button type="button" className={styles.dangerButton} aria-label={`${chapterLabel} 삭제`} onClick={() => void confirmChange({
                          title: "챕터를 삭제할까요?",
                          description: `“${chapter.title || chapterLabel}”의 항목 ${chapter.items.length}개가 함께 삭제됩니다. 전체 저장 전에는 변경 취소로 되돌릴 수 있습니다.`,
                          confirmLabel: "챕터 삭제",
                          tone: "danger",
                        }, () => setChapters(chapters.filter((entry) => entry.key !== chapter.key)))}>삭제</button>
                      </div>
                    </div>
                    <div className={styles.chapterMeta}><span>항목 {chapter.items.length} / {MAX_MARKETING_ITEMS_PER_CHAPTER}개</span><span>번호 있는 차시 {countMarketingLessons([chapter])}개</span></div>
                    {chapter.items.length === 0 && <p className={styles.emptyChapter}>아직 항목이 없습니다. 강의 또는 과제를 추가해 주세요.</p>}
                    <ol className={styles.itemList}>
                      {chapter.items.map((item, itemIndex) => {
                        const itemLabel = `${chapterLabel} ${itemIndex + 1}번째 항목`;
                        return (
                          <li key={item.key} className={styles.item}>
                            <span className={styles.itemPosition}>{itemIndex + 1}<span className={styles.srOnly}>번째 항목</span></span>
                            <div className={styles.kindField}>
                              <label htmlFor={`kind-${item.key}`}>유형<span className={styles.srOnly}> · {itemLabel}</span></label>
                              <select id={`kind-${item.key}`} value={item.kind} onChange={(event) => {
                                const kind = event.target.value as MarketingCurriculumItem["kind"];
                                updateItem(chapter.key, item.key, { kind, lessonNumber: kind === "lesson" && item.lessonNumber === null ? nextLessonNumber(chapters) : item.lessonNumber });
                              }}><option value="lesson">강의</option><option value="assignment">과제</option></select>
                            </div>
                            <div className={styles.numberField}>
                              <label htmlFor={`number-${item.key}`}>차시 번호<span className={styles.srOnly}> · {itemLabel}{item.kind === "assignment" ? " (선택)" : " (필수)"}</span></label>
                              <input id={`number-${item.key}`} type="number" min="1" max="999" step="1" required={item.kind === "lesson"} inputMode="numeric" value={item.lessonNumber ?? ""} placeholder={item.kind === "assignment" ? "없음" : "번호"} onChange={(event) => updateItem(chapter.key, item.key, { lessonNumber: event.target.value === "" ? null : Number(event.target.value) })} />
                            </div>
                            <div className={styles.itemTitle}>
                              <label htmlFor={`item-title-${item.key}`}>{item.kind === "assignment" ? "과제 제목" : "강의 제목"}<span className={styles.srOnly}> · {itemLabel}</span></label>
                              <input id={`item-title-${item.key}`} type="text" value={item.title} placeholder={item.kind === "assignment" ? "과제 제목을 입력하세요" : "강의 제목을 입력하세요"} onChange={(event) => updateItem(chapter.key, item.key, { title: event.target.value })} />
                            </div>
                            <div className={styles.rowActions}>
                              <button type="button" className={styles.iconButton} aria-label={`${itemLabel} 위로 이동`} disabled={itemIndex === 0} onClick={() => updateChapter(chapter.key, { items: moveEntry(chapter.items, itemIndex, -1) })}><ArrowUpIcon /></button>
                              <button type="button" className={styles.iconButton} aria-label={`${itemLabel} 아래로 이동`} disabled={itemIndex === chapter.items.length - 1} onClick={() => updateChapter(chapter.key, { items: moveEntry(chapter.items, itemIndex, 1) })}><ArrowDownIcon /></button>
                              <button type="button" className={styles.dangerButton} aria-label={`${itemLabel} 삭제`} onClick={() => void confirmChange({
                                title: `${item.kind === "assignment" ? "과제" : "강의"} 항목을 삭제할까요?`,
                                description: `“${item.title || itemLabel}”을 공개 목록에서 삭제합니다. 전체 저장 전에는 변경 취소로 되돌릴 수 있습니다.`,
                                confirmLabel: "항목 삭제",
                                tone: "danger",
                              }, () => setChapters(chapters.map((entry) => entry.key === chapter.key ? { ...entry, items: entry.items.filter((entryItem) => entryItem.key !== item.key) } : entry)))}>삭제</button>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                    <div className={styles.chapterFooter}>
                      <div className={styles.addActions}>
                        <button type="button" className={styles.secondaryButton} disabled={atItemLimit} onClick={() => addItem(chapter, "lesson")}><PlusIcon />강의 추가</button>
                        <button type="button" className={styles.secondaryButton} disabled={atItemLimit} onClick={() => addItem(chapter, "assignment")}><PlusIcon />과제 추가</button>
                      </div>
                      <span>{atItemLimit ? "추가 가능한 항목 수에 도달했습니다." : "과제는 차시 번호를 비워 둘 수 있습니다."}</span>
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        </fieldset>

        <footer className={styles.saveBar}>
          <div className={styles.saveStatus} role="status" aria-live="polite">
            <strong>{busy === "saving" ? "전체 내용을 저장하고 있습니다" : busy === "reloading" ? "최신 내용을 불러오고 있습니다" : dirty ? "저장하지 않은 변경사항이 있습니다" : canEdit ? "모든 변경사항이 저장되어 있습니다" : "읽기 전용으로 보고 있습니다"}</strong>
            <span>{version !== null ? `저장 버전 ${version} · ` : ""}전체 저장을 누르면 모든 챕터와 항목이 한 번에 반영됩니다.</span>
          </div>
          <div className={styles.saveActions}>
            <button type="button" className={styles.secondaryButton} disabled={!canEdit || !dirty || locked} onClick={() => void confirmChange({
              title: "편집한 내용을 취소할까요?",
              description: "저장하지 않은 변경사항을 모두 버리고 이 화면에서 마지막으로 저장한 내용으로 되돌립니다.",
              confirmLabel: "변경 취소",
              tone: "danger",
            }, () => setChapters(savedChapters))}>변경 취소</button>
            <button type="button" className={styles.secondaryButton} disabled={locked} onClick={() => void reloadLatest()}>최신 내용 다시 불러오기</button>
            <button type="submit" className={styles.primaryButton} disabled={!canSave}>{busy === "saving" ? "저장 중…" : "전체 저장"}</button>
          </div>
        </footer>
      </form>
    </div>
  );
}
