"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  createCourseAction,
  createCourseSectionAction,
  createLessonAction,
  moveCourseContentAction,
  updateCourseAction,
  updateCourseSectionAction,
  updateLessonAction,
  type CourseFormState,
} from "@/app/admin/courses/actions";
import type {
  AdminCourse,
  AdminCourseSection,
  AdminCourseStatus,
  AdminLesson,
  CourseProductOption,
} from "@/lib/admin/courses";
import {
  formatVideoDuration,
  formatVideoFileSize,
  readVideoFileDuration,
  validateCourseVideoFile,
} from "@/lib/admin/video-file";
import AdminLessonVideoDialog from "./AdminLessonVideoDialog";
import styles from "./AdminCourseManager.module.css";

type AdminCourseManagerProps = {
  courses: AdminCourse[];
  availableProducts: CourseProductOption[];
  databaseReady: boolean;
  videoStorageReady: boolean;
  sourceMessage: string | null;
};

type DialogState =
  | { type: "create-course"; productId?: string }
  | { type: "edit-course"; course: AdminCourse }
  | { type: "create-section"; course: AdminCourse }
  | { type: "edit-section"; section: AdminCourseSection }
  | {
      type: "create-lesson";
      courseSlug: string;
      section: AdminCourseSection;
    }
  | { type: "edit-lesson"; section: AdminCourseSection; lesson: AdminLesson }
  | {
      type: "manage-video";
      courseSlug: string;
      sectionTitle: string;
      lesson: AdminLesson;
      initialFile?: File;
      autoStart?: boolean;
    };

const initialFormState: CourseFormState = {
  status: "idle",
  message: "",
  fieldErrors: {},
};

export default function AdminCourseManager({
  courses,
  availableProducts,
  databaseReady,
  videoStorageReady,
  sourceMessage,
}: AdminCourseManagerProps) {
  const [selectedCourseId, setSelectedCourseId] = useState(courses[0]?.id ?? "");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const selectedCourse =
    courses.find((course) => course.id === selectedCourseId) ?? courses[0] ?? null;
  const allLessons = courses.flatMap((course) =>
    course.sections.flatMap((section) => section.lessons)
  );
  const summary = {
    courses: courses.length,
    sections: courses.reduce((total, course) => total + course.sections.length, 0),
    lessons: allLessons.length,
    connectedVideos: allLessons.filter((lesson) => lesson.videoPath).length,
  };

  const moveItem = async (
    kind: "section" | "lesson",
    itemId: string,
    direction: -1 | 1
  ) => {
    if (!databaseReady || movingId) return;
    setMovingId(itemId);
    setNotice(null);
    try {
      const result = await moveCourseContentAction(kind, itemId, direction);
      setNotice(result.message);
    } catch {
      setNotice("순서를 변경하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setMovingId(null);
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>COURSES</p>
          <h1>강의 관리</h1>
          <p>판매 상품과 강의를 연결하고 챕터, 차시와 영상 공개 상태를 관리합니다.</p>
        </div>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!databaseReady || availableProducts.length === 0}
          onClick={() => setDialog({ type: "create-course" })}
          title={
            !databaseReady
              ? "현재 강의 관리 기능을 사용할 수 없습니다."
              : availableProducts.length === 0
                ? "연결하지 않은 강의 상품이 없습니다."
                : undefined
          }
        >
          <PlusIcon />
          새 강의 연결
        </button>
      </section>

      {!databaseReady && (
        <div className={styles.setupNotice} role="status">
          <DatabaseIcon />
          <div>
            <strong>현재 강의 정보를 수정할 수 없습니다.</strong>
            <p>
              {sourceMessage}
              {availableProducts.length > 0 && (
                <> 등록한 VOD 상품 {availableProducts.length}개는 안전하게 보관되어 있습니다.</>
              )}
            </p>
          </div>
        </div>
      )}

      {notice && (
        <div className={styles.actionNotice} role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="안내 닫기">
            <CloseIcon />
          </button>
        </div>
      )}

      <section className={styles.summaryBar} aria-label="강의 콘텐츠 요약">
        <SummaryItem label="연결된 강의" value={summary.courses} unit="개" />
        <SummaryItem label="전체 챕터" value={summary.sections} unit="개" />
        <SummaryItem label="전체 차시" value={summary.lessons} unit="강" />
        <SummaryItem
          label="영상 연결"
          value={summary.connectedVideos}
          unit={`/${summary.lessons}`}
          tone={summary.connectedVideos === summary.lessons ? "ready" : "warning"}
        />
      </section>

      <section className={styles.courseWorkspace}>
        <aside className={styles.courseRail} aria-label="강의 목록">
          <div className={styles.railHeader}>
            <div>
              <h2>강의 목록</h2>
              <p>상품당 하나의 강의를 연결합니다.</p>
            </div>
            <span>{courses.length}</span>
          </div>

          {availableProducts.length > 0 && (
            <div className={styles.pendingProducts}>
              <div className={styles.pendingHeader}>
                <span>강의 연결 대기</span>
                <strong>{availableProducts.length}</strong>
              </div>
              <p>상품 유형이 VOD 강의인 미연결 상품입니다.</p>
              <div className={styles.pendingList}>
                {availableProducts.map((product) => (
                  <button
                    type="button"
                    key={product.id}
                    disabled={!databaseReady}
                    onClick={() =>
                      setDialog({ type: "create-course", productId: product.id })
                    }
                  >
                    <span><PlusIcon /></span>
                    <span>
                      <strong>{product.title}</strong>
                      <small>/{product.slug} · {formatProductStatus(product.status)}</small>
                    </span>
                    <em>{databaseReady ? "강의 만들기" : "일시 사용 불가"}</em>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={styles.courseList}>
            {courses.map((course) => {
              const lessonCount = countLessons(course);
              const videoCount = countConnectedVideos(course);
              const selected = selectedCourse?.id === course.id;

              return (
                <button
                  type="button"
                  key={course.id}
                  className={selected ? styles.courseItemActive : styles.courseItem}
                  onClick={() => setSelectedCourseId(course.id)}
                  aria-pressed={selected}
                >
                  <span className={styles.courseItemIcon}><PlayIcon /></span>
                  <span className={styles.courseItemCopy}>
                    <strong>{course.shortTitle}</strong>
                    <small>{course.sections.length}개 챕터 · {lessonCount}강</small>
                    <span>
                      <StatusDot status={course.status} />
                      {formatStatus(course.status)}
                      <i aria-hidden="true" />
                      영상 {videoCount}/{lessonCount}
                    </span>
                  </span>
                  <ChevronRightIcon />
                </button>
              );
            })}
          </div>

          {courses.length === 0 && (
            <div className={styles.railEmpty}>
              <PlayIcon />
              <strong>연결된 강의가 없습니다.</strong>
              <p>강의 상품을 만든 뒤 강의를 연결해 주세요.</p>
            </div>
          )}
        </aside>

        <div className={styles.editorPanel}>
          {selectedCourse ? (
            <CourseEditor
              course={selectedCourse}
              editable={databaseReady && selectedCourse.source === "database"}
              videoStorageReady={videoStorageReady}
              movingId={movingId}
              onOpenDialog={setDialog}
              onMove={moveItem}
            />
          ) : (
            <div className={styles.editorEmpty}>
              <PlayIcon />
              <strong>관리할 강의를 선택해 주세요.</strong>
              <p>강의를 연결하면 챕터와 차시를 구성할 수 있습니다.</p>
            </div>
          )}
        </div>
      </section>

      {dialog?.type === "create-course" && (
        <CourseCreateDialog
          products={availableProducts}
          defaultProductId={dialog.productId}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "edit-course" && (
        <CourseEditDialog course={dialog.course} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "create-section" && (
        <SectionDialog
          mode="create"
          course={dialog.course}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "edit-section" && (
        <SectionDialog
          mode="edit"
          section={dialog.section}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "create-lesson" && (
        <LessonDialog
          mode="create"
          section={dialog.section}
          storageReady={videoStorageReady}
          onClose={() => setDialog(null)}
          onCreated={(lesson, videoFile) => {
            if (!videoFile) {
              setNotice("새 차시를 작성 중 상태로 추가했습니다.");
              setDialog(null);
              return;
            }
            setDialog({
              type: "manage-video",
              courseSlug: dialog.courseSlug,
              sectionTitle: dialog.section.title,
              lesson,
              initialFile: videoFile,
              autoStart: true,
            });
          }}
        />
      )}
      {dialog?.type === "edit-lesson" && (
        <LessonDialog
          mode="edit"
          section={dialog.section}
          lesson={dialog.lesson}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "manage-video" && (
        <AdminLessonVideoDialog
          courseSlug={dialog.courseSlug}
          sectionTitle={dialog.sectionTitle}
          lesson={dialog.lesson}
          storageReady={videoStorageReady}
          initialFile={dialog.initialFile}
          autoStart={dialog.autoStart}
          onClose={() => setDialog(null)}
          onComplete={(message) => {
            setNotice(message);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function SummaryItem({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: number;
  unit: string;
  tone?: "ready" | "warning";
}) {
  return (
    <div className={styles.summaryItem}>
      <span>{label}</span>
      <strong className={tone ? styles[tone] : undefined}>
        {value}<small>{unit}</small>
      </strong>
    </div>
  );
}

function CourseEditor({
  course,
  editable,
  videoStorageReady,
  movingId,
  onOpenDialog,
  onMove,
}: {
  course: AdminCourse;
  editable: boolean;
  videoStorageReady: boolean;
  movingId: string | null;
  onOpenDialog: (dialog: DialogState) => void;
  onMove: (
    kind: "section" | "lesson",
    itemId: string,
    direction: -1 | 1
  ) => Promise<void>;
}) {
  const lessonCount = countLessons(course);
  const videoCount = countConnectedVideos(course);
  const publishedLessons = course.sections
    .filter((section) => section.status === "published")
    .flatMap((section) => section.lessons.filter((lesson) => lesson.status === "published"));
  const missingPublishedVideoCount = publishedLessons.filter(
    (lesson) => !lesson.videoPath
  ).length;
  const curriculumReady =
    publishedLessons.length > 0 && missingPublishedVideoCount === 0;
  const outlineSections = course.sections.filter((section) => section.status !== "archived");
  const outlineLessonCount = outlineSections.reduce(
    (total, section) =>
      total + section.lessons.filter((lesson) => lesson.status !== "archived").length,
    0
  );
  const salesPageReady = course.productStatus === "active" && course.status !== "archived";
  const classroomReady =
    course.productStatus === "active" && course.status === "published" && curriculumReady;
  const classroomBlocker = getClassroomBlocker(
    course,
    publishedLessons.length,
    missingPublishedVideoCount
  );

  return (
    <>
      <header className={styles.editorHeader}>
        <div className={styles.editorTitle}>
          <div className={styles.productConnection}>
            <span>연결 상품</span>
            <strong>{course.productTitle}</strong>
            <em className={styles[`product_${course.productStatus}`]}>
              {formatProductStatus(course.productStatus)}
            </em>
          </div>
          <h2>{course.title}</h2>
          <p>/{course.slug} · 강사 {course.instructor || "미입력"}</p>
        </div>
        <div className={styles.editorHeaderActions}>
          <span className={`${styles.statusBadge} ${styles[course.status]}`}>
            {formatStatus(course.status)}
          </span>
          {editable && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => onOpenDialog({ type: "edit-course", course })}
            >
              기본 정보 수정
            </button>
          )}
          <Link href={`/learn/${course.slug}?adminPreview=1`} className={styles.previewLink}>
            관리자 미리보기 <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>

      <div className={styles.exposureGrid} aria-label="사용자 화면 노출 상태">
        <ExposureState
          label="판매용 커리큘럼"
          ready={salesPageReady && outlineLessonCount > 0}
          value={salesPageReady ? `${outlineLessonCount}개 차시 표시` : "숨김"}
          description="작성 중 차시도 표시하고 보관한 콘텐츠만 제외합니다."
        />
        <ExposureState
          label="수강생 강의실"
          ready={classroomReady}
          value={classroomReady ? "입장 가능" : "준비 중"}
          description={
            classroomReady
              ? `${publishedLessons.length}개 차시를 재생할 수 있습니다.`
              : classroomBlocker
          }
        />
      </div>

      <div className={curriculumReady ? styles.readinessReady : styles.readinessWarning}>
        {curriculumReady ? <CheckIcon /> : <AlertIcon />}
        <div>
          <strong>
            {publishedLessons.length === 0
              ? "공개 상태인 차시가 없습니다."
              : missingPublishedVideoCount > 0
                ? `공개 차시 중 영상이 연결되지 않은 차시가 ${missingPublishedVideoCount}개 있습니다.`
                : `공개 가능한 차시가 ${publishedLessons.length}개입니다.`}
          </strong>
          <p>
            {publishedLessons.length === 0
              ? "영상을 연결한 차시를 공개 상태로 바꾼 뒤 강의를 공개하세요."
              : missingPublishedVideoCount > 0
                ? "영상이 없는 공개 차시는 강의 공개를 막습니다. 영상을 연결하거나 작성 중으로 변경하세요."
                : "작성 중 차시는 강의실 목차에 ‘추후 공개’로 표시되고 재생은 차단됩니다."}
          </p>
        </div>
      </div>

      <div className={styles.curriculumHeader}>
        <div>
          <h3>커리큘럼</h3>
          <p>{course.sections.length}개 챕터 · {lessonCount}개 차시 · 영상 {videoCount}개 연결</p>
        </div>
        {editable && (
          <button
            type="button"
            className={styles.addSectionButton}
            onClick={() => onOpenDialog({ type: "create-section", course })}
          >
            <PlusIcon /> 챕터 추가
          </button>
        )}
      </div>

      <div className={styles.sectionList}>
        {course.sections.map((section, sectionIndex) => (
          <CourseSectionCard
            key={section.id}
            section={section}
            courseSlug={course.slug}
            sectionIndex={sectionIndex}
            sectionCount={course.sections.length}
            editable={editable}
            videoStorageReady={videoStorageReady}
            movingId={movingId}
            onOpenDialog={onOpenDialog}
            onMove={onMove}
          />
        ))}
      </div>

      {course.sections.length === 0 && (
        <div className={styles.curriculumEmpty}>
          <LayersIcon />
          <strong>아직 챕터가 없습니다.</strong>
          <p>첫 챕터를 만든 뒤 차시와 영상을 연결해 주세요.</p>
          {editable && (
            <button
              type="button"
              onClick={() => onOpenDialog({ type: "create-section", course })}
            >
              첫 챕터 추가
            </button>
          )}
        </div>
      )}
    </>
  );
}

function CourseSectionCard({
  section,
  courseSlug,
  sectionIndex,
  sectionCount,
  editable,
  videoStorageReady,
  movingId,
  onOpenDialog,
  onMove,
}: {
  section: AdminCourseSection;
  courseSlug: string;
  sectionIndex: number;
  sectionCount: number;
  editable: boolean;
  videoStorageReady: boolean;
  movingId: string | null;
  onOpenDialog: (dialog: DialogState) => void;
  onMove: (
    kind: "section" | "lesson",
    itemId: string,
    direction: -1 | 1
  ) => Promise<void>;
}) {
  return (
    <details className={styles.sectionCard} open={sectionIndex === 0}>
      <summary>
        <span className={styles.sectionNumber}>{String(sectionIndex + 1).padStart(2, "0")}</span>
        <span className={styles.sectionTitle}>
          <strong>{section.title}</strong>
          <small>{section.lessons.length}개 차시</small>
        </span>
        <span className={`${styles.compactStatus} ${styles[section.status]}`}>
          {formatStatus(section.status)}
        </span>
        {editable && (
          <span
            className={styles.sectionActions}
            onClick={(event) => event.preventDefault()}
          >
            <OrderButtons
              disabled={movingId !== null}
              canMoveUp={sectionIndex > 0}
              canMoveDown={sectionIndex < sectionCount - 1}
              onUp={() => onMove("section", section.id, -1)}
              onDown={() => onMove("section", section.id, 1)}
              label="챕터"
            />
            <button
              type="button"
              onClick={() => onOpenDialog({ type: "edit-section", section })}
            >
              챕터 수정
            </button>
            <button
              type="button"
              className={styles.accentAction}
              onClick={() =>
                onOpenDialog({ type: "create-lesson", courseSlug, section })
              }
            >
              <PlusIcon /> 차시 추가
            </button>
          </span>
        )}
        <ChevronIcon />
      </summary>

      <div className={styles.sectionBody}>
        <div className={styles.sectionMeta}>
          <p>{section.description || "챕터 설명이 없습니다."}</p>
        </div>

        <div className={styles.lessonList}>
          {section.lessons.map((lesson, lessonIndex) => (
            <div className={styles.lessonRow} key={lesson.id}>
              <span className={styles.lessonIndex}>{lessonIndex + 1}</span>
              <span className={styles.lessonMain}>
                <strong>{lesson.title}</strong>
                <small>{lesson.key} · {formatDuration(lesson.durationSeconds)}</small>
              </span>
              <span className={lesson.videoPath ? styles.videoReady : styles.videoMissing}>
                {lesson.videoPath ? <VideoIcon /> : <AlertIcon />}
                {lesson.videoPath
                  ? lesson.videoProvider === "supabase"
                    ? "업로드 완료"
                    : "기존 영상"
                  : "영상 미연결"}
              </span>
              <span className={`${styles.compactStatus} ${styles[lesson.status]}`}>
                {formatStatus(lesson.status)}
              </span>
              {editable && (
                <span className={styles.lessonActions}>
                  <OrderButtons
                    disabled={movingId !== null}
                    canMoveUp={lessonIndex > 0}
                    canMoveDown={lessonIndex < section.lessons.length - 1}
                    onUp={() => onMove("lesson", lesson.id, -1)}
                    onDown={() => onMove("lesson", lesson.id, 1)}
                    label="차시"
                    compact
                  />
                  <button
                    type="button"
                    className={lesson.videoPath ? styles.videoActionReady : styles.videoAction}
                    disabled={!videoStorageReady}
                    title={
                      videoStorageReady
                        ? undefined
                        : "현재 영상 저장 기능을 준비하고 있습니다."
                    }
                    onClick={() =>
                      onOpenDialog({
                        type: "manage-video",
                        courseSlug,
                        sectionTitle: section.title,
                        lesson,
                      })
                    }
                  >
                    {lesson.videoPath ? "영상 관리" : "영상 업로드"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onOpenDialog({ type: "edit-lesson", section, lesson })
                    }
                  >
                    수정
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>

        {section.lessons.length === 0 && (
          <div className={styles.lessonEmpty}>이 챕터에 등록된 차시가 없습니다.</div>
        )}
      </div>
    </details>
  );
}

function OrderButtons({
  disabled,
  canMoveUp,
  canMoveDown,
  onUp,
  onDown,
  label,
  compact = false,
}: {
  disabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onUp: () => void;
  onDown: () => void;
  label: string;
  compact?: boolean;
}) {
  return (
    <span className={compact ? styles.orderButtonsCompact : styles.orderButtons}>
      <button
        type="button"
        disabled={disabled || !canMoveUp}
        onClick={onUp}
        aria-label={`${label} 위로 이동`}
      >
        <ArrowUpIcon />
      </button>
      <button
        type="button"
        disabled={disabled || !canMoveDown}
        onClick={onDown}
        aria-label={`${label} 아래로 이동`}
      >
        <ArrowDownIcon />
      </button>
    </span>
  );
}

function CourseCreateDialog({
  products,
  defaultProductId,
  onClose,
}: {
  products: CourseProductOption[];
  defaultProductId?: string;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    createCourseAction,
    initialFormState
  );
  const defaultProduct = products.find(
    (product) => product.id === defaultProductId
  );

  return (
    <CourseDialogShell
      eyebrow="CONNECT COURSE"
      title="새 강의 연결"
      description="판매 상품을 선택하고 강의 기본 정보를 입력합니다. 가격과 이용 기간은 상품 관리에서 유지됩니다."
      pending={pending}
      state={state}
      onClose={onClose}
    >
      <form action={formAction} className={styles.dialogForm}>
        <FormMessage state={state} />
        <label className={styles.formField}>
          <span>연결 상품</span>
          <span className={styles.selectControl}>
            <select name="productId" required defaultValue={defaultProductId ?? ""}>
              <option value="" disabled>강의 상품 선택</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title} · {formatProductStatus(product.status)}
                </option>
              ))}
            </select>
            <ChevronIcon />
          </span>
          <FieldError message={state.fieldErrors.productId} />
        </label>
        <CourseFields
          state={state}
          defaultTitle={defaultProduct?.title}
          defaultShortTitle={defaultProduct?.title.slice(0, 80)}
        />
        <input type="hidden" name="status" value="draft" />
        <DialogActions pending={pending} onClose={onClose} submitLabel="강의 연결" />
      </form>
    </CourseDialogShell>
  );
}

function CourseEditDialog({ course, onClose }: { course: AdminCourse; onClose: () => void }) {
  const action = useMemo(() => updateCourseAction.bind(null, course.id), [course.id]);
  const [state, formAction, pending] = useActionState(action, initialFormState);

  return (
    <CourseDialogShell
      eyebrow="EDIT COURSE"
      title="강의 기본 정보 수정"
      description="강의실에 표시되는 정보와 콘텐츠 공개 상태를 관리합니다."
      pending={pending}
      state={state}
      onClose={onClose}
    >
      <form
        action={formAction}
        className={styles.dialogForm}
        onSubmit={(event) => {
          const nextStatus = new FormData(event.currentTarget).get("status");
          if (
            nextStatus !== course.status &&
            !window.confirm(
              getCourseStatusConfirmMessage(course, String(nextStatus) as AdminCourseStatus)
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <FormMessage state={state} />
        <div className={styles.lockedMeta}>
          <span>연결 상품</span>
          <strong>{course.productTitle}</strong>
          <small>/{course.slug}</small>
        </div>
        <CourseFields state={state} course={course} />
        <label className={styles.formField}>
          <span>강의 상태</span>
          <span className={styles.selectControl}>
            <select name="status" defaultValue={course.status}>
              <option value="draft">작성 중</option>
              <option value="published">공개</option>
              <option value="archived">보관</option>
            </select>
            <ChevronIcon />
          </span>
          <FieldError message={state.fieldErrors.status} />
        </label>
        <DialogActions pending={pending} onClose={onClose} submitLabel="변경 내용 저장" />
      </form>
    </CourseDialogShell>
  );
}

function CourseFields({
  state,
  course,
  defaultTitle,
  defaultShortTitle,
}: {
  state: CourseFormState;
  course?: AdminCourse;
  defaultTitle?: string;
  defaultShortTitle?: string;
}) {
  return (
    <>
      <div className={styles.formGrid}>
        <TextField
          label="강의명"
          name="title"
          defaultValue={course?.title ?? defaultTitle}
          error={state.fieldErrors.title}
          required
        />
        <TextField
          label="짧은 강의명"
          name="shortTitle"
          defaultValue={course?.shortTitle ?? defaultShortTitle}
          error={state.fieldErrors.shortTitle}
          required
        />
        <TextField
          label="강사명"
          name="instructor"
          defaultValue={course?.instructor}
          error={state.fieldErrors.instructor}
          placeholder="예: 이윰"
        />
        <TextField
          label="포스터 경로"
          name="posterPath"
          defaultValue={course?.posterPath ?? ""}
          placeholder="/assets/course-cover.jpg"
          error={state.fieldErrors.posterPath}
          description="사이트 내부 이미지 경로만 사용할 수 있습니다."
        />
      </div>
      <label className={styles.formField}>
        <span>강의 소개</span>
        <textarea
          name="description"
          rows={4}
          maxLength={1000}
          defaultValue={course?.description}
          placeholder="강의실과 마이 클래스에 표시할 소개를 입력하세요."
        />
        <FieldError message={state.fieldErrors.description} />
      </label>
    </>
  );
}

function SectionDialog(props:
  | { mode: "create"; course: AdminCourse; onClose: () => void }
  | { mode: "edit"; section: AdminCourseSection; onClose: () => void }
) {
  const isCreate = props.mode === "create";
  const targetId = isCreate ? props.course.id : props.section.id;
  const action = useMemo(
    () =>
      isCreate
        ? createCourseSectionAction.bind(null, targetId)
        : updateCourseSectionAction.bind(null, targetId),
    [isCreate, targetId]
  );
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const section = isCreate ? undefined : props.section;

  return (
    <CourseDialogShell
      eyebrow={isCreate ? "NEW CHAPTER" : "EDIT CHAPTER"}
      title={isCreate ? "챕터 추가" : "챕터 정보 수정"}
      description="차시를 주제별로 묶는 단위입니다. 식별 키는 생성 후 변경할 수 없습니다."
      pending={pending}
      state={state}
      onClose={props.onClose}
    >
      <form action={formAction} className={styles.dialogForm}>
        <FormMessage state={state} />
        {isCreate ? (
          <TextField
            label="챕터 키"
            name="sectionKey"
            placeholder="예: account-setup"
            description="영문 소문자, 숫자와 하이픈만 사용"
            error={state.fieldErrors.sectionKey}
            required
          />
        ) : (
          <div className={styles.lockedMeta}>
            <span>챕터 키</span><strong>{section?.key}</strong><small>생성 후 변경 불가</small>
          </div>
        )}
        <TextField
          label="챕터명"
          name="title"
          defaultValue={section?.title}
          error={state.fieldErrors.title}
          required
        />
        <label className={styles.formField}>
          <span>챕터 설명</span>
          <textarea name="description" rows={3} maxLength={500} defaultValue={section?.description} />
          <FieldError message={state.fieldErrors.description} />
        </label>
        <StatusField defaultValue={section?.status ?? "draft"} label="챕터 상태" />
        <DialogActions
          pending={pending}
          onClose={props.onClose}
          submitLabel={isCreate ? "챕터 추가" : "변경 내용 저장"}
        />
      </form>
    </CourseDialogShell>
  );
}

function LessonDialog(props:
  | {
      mode: "create";
      section: AdminCourseSection;
      storageReady: boolean;
      onClose: () => void;
      onCreated: (lesson: AdminLesson, videoFile: File | null) => void;
    }
  | { mode: "edit"; section: AdminCourseSection; lesson: AdminLesson; onClose: () => void }
) {
  const isCreate = props.mode === "create";
  const lesson = isCreate ? undefined : props.lesson;
  const targetId = isCreate ? props.section.id : props.lesson.id;
  const videoInputRef = useRef<HTMLInputElement>(null);
  const createdLessonHandledRef = useRef<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoReading, setVideoReading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(
    lesson?.durationSeconds ?? 0
  );
  const onCreated = isCreate ? props.onCreated : null;
  const action = useMemo(
    () =>
      isCreate
        ? createLessonAction.bind(null, targetId)
        : updateLessonAction.bind(null, targetId),
    [isCreate, targetId]
  );
  const [state, formAction, pending] = useActionState(action, initialFormState);

  useEffect(() => {
    if (
      !isCreate ||
      !state.createdLesson ||
      createdLessonHandledRef.current === state.createdLesson.id
    ) {
      return;
    }

    createdLessonHandledRef.current = state.createdLesson.id;
    onCreated?.(state.createdLesson, videoFile);
  }, [isCreate, onCreated, state.createdLesson, videoFile]);

  const handleVideoFileChange = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setVideoError(null);
    const validationMessage = validateCourseVideoFile(file);
    if (validationMessage) {
      setVideoFile(null);
      setVideoError(validationMessage);
      return;
    }

    setVideoReading(true);
    try {
      const duration = await readVideoFileDuration(file);
      setVideoFile(file);
      setDurationSeconds(Math.max(1, Math.round(duration)));
    } catch {
      setVideoFile(null);
      setVideoError(
        "영상 정보를 읽지 못했습니다. 재생 가능한 MP4 파일인지 확인해 주세요."
      );
    } finally {
      setVideoReading(false);
    }
  };

  return (
    <CourseDialogShell
      eyebrow={isCreate ? "NEW LESSON" : "EDIT LESSON"}
      title={isCreate ? "차시 추가" : "차시 정보 수정"}
      description={`${props.section.title} 챕터의 차시 정보와 공개 상태를 관리합니다.`}
      pending={pending}
      state={state}
      onClose={props.onClose}
    >
      <form action={formAction} className={styles.dialogForm}>
        <FormMessage state={state} />
        {isCreate ? (
          <TextField
            label="차시 키"
            name="lessonKey"
            placeholder="예: sns-33"
            description="진도 기록에 사용하므로 생성 후 변경할 수 없습니다."
            error={state.fieldErrors.lessonKey}
            required
          />
        ) : (
          <div className={styles.lockedMeta}>
            <span>차시 키</span><strong>{lesson?.key}</strong><small>진도 기록 보호를 위해 변경 불가</small>
          </div>
        )}
        <TextField
          label="차시명"
          name="title"
          defaultValue={lesson?.title}
          error={state.fieldErrors.title}
          required
        />
        {isCreate && (
          <div
            className={styles.videoCreateField}
            role="group"
            aria-labelledby="lesson-video-label"
          >
            <div className={styles.videoCreateHeading}>
              <div>
                <span id="lesson-video-label">강의 영상</span>
                <small>선택 사항</small>
              </div>
              <span>MP4 · 최대 50MB</span>
            </div>

            {videoFile ? (
              <div className={styles.videoCreateSelected}>
                <span className={styles.videoCreateIcon}><VideoIcon /></span>
                <span>
                  <strong>{videoFile.name}</strong>
                  <small>
                    {formatVideoFileSize(videoFile.size)} · {formatVideoDuration(durationSeconds)}
                  </small>
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => videoInputRef.current?.click()}
                >
                  교체
                </button>
                <button
                  type="button"
                  disabled={pending}
                  aria-label="선택한 영상 제거"
                  onClick={() => {
                    setVideoFile(null);
                    setDurationSeconds(0);
                    setVideoError(null);
                  }}
                >
                  <CloseIcon />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={styles.videoCreatePicker}
                disabled={
                  pending || videoReading || props.storageReady === false
                }
                onClick={() => videoInputRef.current?.click()}
              >
                <span><VideoIcon /></span>
                <span>
                  <strong>
                    {videoReading
                      ? "영상 정보를 확인하고 있습니다"
                      : props.storageReady
                        ? "영상 파일 선택"
                        : "영상 업로드를 준비하고 있습니다"}
                  </strong>
                  <small>
                    {props.storageReady
                      ? "차시를 만든 직후 선택한 영상을 자동으로 업로드합니다."
                      : "준비가 끝나면 차시 추가와 영상 업로드를 한 번에 진행할 수 있습니다."}
                  </small>
                </span>
              </button>
            )}

            {videoError ? (
              <p className={styles.videoCreateError} role="alert">{videoError}</p>
            ) : (
              <p className={styles.videoCreateHelp}>
                영상이 준비되지 않았다면 차시만 먼저 작성 중 상태로 저장할 수 있습니다.
              </p>
            )}
            <input
              ref={videoInputRef}
              className={styles.videoFileInput}
              type="file"
              accept="video/mp4,.mp4"
              onChange={(event) => void handleVideoFileChange(event)}
              tabIndex={-1}
            />
          </div>
        )}
        <div className={styles.formGrid}>
          <label className={styles.formField}>
            <span>영상 길이</span>
            <input
              type="number"
              name="durationSeconds"
              min="0"
              value={durationSeconds}
              onChange={(event) => setDurationSeconds(Number(event.target.value))}
              required
              aria-invalid={Boolean(state.fieldErrors.durationSeconds)}
            />
            {state.fieldErrors.durationSeconds ? (
              <FieldError message={state.fieldErrors.durationSeconds} />
            ) : (
              <small>{videoFile ? "선택한 영상에서 자동으로 확인했습니다." : "초 단위로 입력"}</small>
            )}
          </label>
          {isCreate ? (
            <label className={styles.formField}>
              <span>차시 상태</span>
              <span className={styles.draftStatusField}>작성 중</span>
              <small>영상 업로드를 마친 뒤 공개할 수 있습니다.</small>
              <input type="hidden" name="status" value="draft" />
            </label>
          ) : (
            <StatusField
              defaultValue={lesson?.status ?? "draft"}
              label="차시 상태"
              error={state.fieldErrors.status}
            />
          )}
        </div>
        {!isCreate && (
          <div className={styles.videoManagementHint}>
            <VideoIcon />
            <span>
              <strong>{lesson?.videoPath ? "영상이 연결되어 있습니다." : "연결된 영상이 없습니다."}</strong>
              <small>강의 목록의 영상 관리 버튼에서 파일 업로드와 교체를 진행할 수 있습니다.</small>
            </span>
          </div>
        )}
        <div className={styles.previewUnavailable} role="note">
          <AlertIcon />
          <span>
            <strong>무료 미리보기는 현재 제공하지 않습니다.</strong>
            <small>결제·체험 기능을 연결하기 전까지 영상은 관리자 또는 수강권 보유자만 재생할 수 있습니다.</small>
          </span>
        </div>
        <DialogActions
          pending={pending}
          disabled={videoReading || Boolean(videoError)}
          onClose={props.onClose}
          submitLabel={
            isCreate
              ? videoFile
                ? "차시 추가 및 영상 업로드"
                : "차시만 추가"
              : "변경 내용 저장"
          }
        />
      </form>
    </CourseDialogShell>
  );
}

function CourseDialogShell({
  eyebrow,
  title,
  description,
  pending,
  state,
  onClose,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  pending: boolean;
  state: CourseFormState;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogBehavior(dialogRef, pending, onClose);

  return (
    <div
      className={styles.dialogBackdrop}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !pending) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="course-dialog-title"
        aria-describedby="course-dialog-description"
      >
        <header className={styles.dialogHeader}>
          <div>
            <span>{eyebrow}</span>
            <h2 id="course-dialog-title">{title}</h2>
            <p id="course-dialog-description">{description}</p>
          </div>
          <button
            autoFocus
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label={`${title} 창 닫기`}
          >
            <CloseIcon />
          </button>
        </header>
        {state.status === "success" ? (
          <div className={styles.successState} role="status">
            <span><CheckIcon /></span>
            <strong>{state.message}</strong>
            <p>변경 내용이 강의 관리 화면에 반영되었습니다.</p>
            <button type="button" onClick={onClose}>목록으로 돌아가기</button>
          </div>
        ) : children}
      </section>
    </div>
  );
}

function DialogActions({
  pending,
  disabled = false,
  onClose,
  submitLabel,
}: {
  pending: boolean;
  disabled?: boolean;
  onClose: () => void;
  submitLabel: string;
}) {
  return (
    <div className={styles.dialogActions}>
      <button type="button" onClick={onClose} disabled={pending}>취소</button>
      <button type="submit" disabled={pending || disabled}>
        {pending ? "저장 중..." : submitLabel}
      </button>
    </div>
  );
}

function FormMessage({ state }: { state: CourseFormState }) {
  return state.status === "error" ? (
    <div className={styles.formError} role="alert">{state.message}</div>
  ) : null;
}

function TextField({
  label,
  name,
  type = "text",
  min,
  defaultValue,
  placeholder,
  description,
  error,
  required,
}: {
  label: string;
  name: string;
  type?: "text" | "number";
  min?: string;
  defaultValue?: string;
  placeholder?: string;
  description?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <label className={styles.formField}>
      <span>{label}</span>
      <input
        type={type}
        name={name}
        min={min}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        aria-invalid={Boolean(error)}
      />
      {error ? <FieldError message={error} /> : description ? <small>{description}</small> : null}
    </label>
  );
}

function StatusField({
  defaultValue,
  label,
  error,
}: {
  defaultValue: AdminCourseStatus;
  label: string;
  error?: string;
}) {
  return (
    <label className={styles.formField}>
      <span>{label}</span>
      <span className={styles.selectControl}>
        <select name="status" defaultValue={defaultValue}>
          <option value="draft">작성 중</option>
          <option value="published">공개</option>
          <option value="archived">보관</option>
        </select>
        <ChevronIcon />
      </span>
      <FieldError message={error} />
    </label>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? <small className={styles.fieldError}>{message}</small> : null;
}

function useDialogBehavior(
  dialogRef: RefObject<HTMLElement | null>,
  pending: boolean,
  onClose: () => void
) {
  useEffect(() => {
    const returnFocusTo = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    return () => returnFocusTo?.focus();
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const elements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]"
        )
      );
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dialogRef, onClose, pending]);
}

function ExposureState({
  label,
  ready,
  value,
  description,
}: {
  label: string;
  ready: boolean;
  value: string;
  description: string;
}) {
  return (
    <div className={ready ? styles.exposureReady : styles.exposureWarning}>
      <span>{label}</span>
      <strong>{ready ? <CheckIcon /> : <AlertIcon />}{value}</strong>
      <small>{description}</small>
    </div>
  );
}

function getClassroomBlocker(
  course: AdminCourse,
  publishedLessonCount: number,
  missingVideoCount: number
) {
  if (course.productStatus !== "active") return "연결 상품이 판매 중이어야 수강생이 입장할 수 있습니다.";
  if (course.status !== "published") return "강의 기본 정보에서 강의 상태를 공개로 변경해 주세요.";
  if (publishedLessonCount === 0) return "공개 챕터 안에 공개 차시가 최소 1개 필요합니다.";
  if (missingVideoCount > 0) return `영상이 없는 공개 차시 ${missingVideoCount}개를 먼저 정리해 주세요.`;
  return "강의실 공개 조건을 확인해 주세요.";
}

function getCourseStatusConfirmMessage(course: AdminCourse, nextStatus: AdminCourseStatus) {
  if (nextStatus === "published") {
    return `‘${course.title}’을 공개할까요?\n판매 중 상품이라면 수강권 보유자가 강의실에 입장할 수 있습니다.`;
  }
  if (nextStatus === "archived") {
    return `‘${course.title}’을 보관할까요?\n판매 페이지 커리큘럼과 수강생 강의실에서 모두 숨겨집니다.`;
  }
  return `‘${course.title}’을 작성 중으로 변경할까요?\n판매 페이지 목차는 유지되지만 수강생은 강의실에 입장할 수 없습니다.`;
}

function StatusDot({ status }: { status: AdminCourseStatus }) {
  return <span className={`${styles.statusDot} ${styles[status]}`} aria-hidden="true" />;
}

function countLessons(course: AdminCourse) {
  return course.sections.reduce((total, section) => total + section.lessons.length, 0);
}

function countConnectedVideos(course: AdminCourse) {
  return course.sections.reduce(
    (total, section) => total + section.lessons.filter((lesson) => lesson.videoPath).length,
    0
  );
}

function formatStatus(status: AdminCourseStatus) {
  return { draft: "작성 중", published: "공개", archived: "보관" }[status];
}

function formatProductStatus(status: AdminCourse["productStatus"]) {
  return { draft: "작성 중", active: "판매 중", paused: "판매 중지", archived: "보관" }[status];
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function PlusIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>; }
function CloseIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>; }
function PlayIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3V9Z" /></svg>; }
function VideoIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4" width="15" height="12" rx="2" /><path d="m8 7.5 4 2.5-4 2.5v-5Z" /></svg>; }
function DatabaseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 10v6M12 7h.01" /></svg>; }
function ChevronIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6.5 8 3.5 3.5L13.5 8" /></svg>; }
function ChevronRightIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 6 4 4-4 4" /></svg>; }
function ArrowUpIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 11 4-4 4 4M10 7v7" /></svg>; }
function ArrowDownIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 9 4 4 4-4M10 13V6" /></svg>; }
function AlertIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3 2.5 16h15L10 3Z" /><path d="M10 7v4M10 14h.01" /></svg>; }
function CheckIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 3 3 7-7" /></svg>; }
function LayersIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 8 8-4 8 4-8 4-8-4Z" /><path d="m4 12 8 4 8-4M4 16l8 4 8-4" /></svg>; }
