"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from "react";
import {
  createProductAction,
  updateProductAction,
  updateProductStatusAction,
} from "@/app/admin/products/actions";
import type { CreateProductState } from "@/app/admin/products/actions";
import type {
  AdminProduct,
  AdminProductStatus,
  AdminProductType,
} from "@/lib/admin/products";
import { FREE_ENROLLMENT_MODE } from "@/lib/store/free-enrollment";
import styles from "./AdminProductManager.module.css";

type AdminProductManagerProps = {
  products: AdminProduct[];
  databaseReady: boolean;
  sourceMessage: string | null;
};

type TypeFilter = "all" | AdminProductType;
type StatusFilter = "all" | AdminProductStatus;

const typeFilters: Array<{ value: TypeFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "course", label: "VOD 강의" },
  { value: "ebook", label: "전자책" },
];

const statusOptions: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "모든 상태" },
  { value: "active", label: "판매 중" },
  { value: "draft", label: "작성 중" },
  { value: "paused", label: "판매 중지" },
  { value: "archived", label: "보관" },
];

const initialCreateProductState: CreateProductState = {
  status: "idle",
  message: "",
  fieldErrors: {},
};

export default function AdminProductManager({
  products,
  databaseReady,
  sourceMessage,
}: AdminProductManagerProps) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<AdminProduct | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingProductId, setSavingProductId] = useState<string | null>(null);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return products.filter((product) => {
      const matchesQuery =
        !normalizedQuery ||
        product.title.toLowerCase().includes(normalizedQuery) ||
        product.slug.toLowerCase().includes(normalizedQuery);
      const matchesType =
        typeFilter === "all" || product.productType === typeFilter;
      const matchesStatus =
        statusFilter === "all" || product.status === statusFilter;

      return matchesQuery && matchesType && matchesStatus;
    });
  }, [products, query, statusFilter, typeFilter]);

  const summary = {
    total: products.length,
    active: products.filter((product) => product.status === "active").length,
    draft: products.filter((product) => product.status === "draft").length,
    unavailable: products.filter(
      (product) => product.status === "paused" || product.status === "archived"
    ).length,
  };

  const updateStatus = async (
    product: AdminProduct,
    nextStatus: AdminProductStatus
  ) => {
    if (!databaseReady || product.source !== "database") return;

    if (!window.confirm(getStatusConfirmMessage(product, nextStatus))) return;

    setSavingProductId(product.id);
    setNotice(null);
    try {
      const result = await updateProductStatusAction(product.id, nextStatus);
      setNotice(result.message);
    } catch {
      setNotice("상품 상태를 변경하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setSavingProductId(null);
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>PRODUCTS</p>
          <h1>상품 관리</h1>
          <p>강의와 전자책의 판매 정보, 이용 기간과 공개 상태를 관리합니다.</p>
        </div>
        <button
          type="button"
          className={styles.createButton}
          disabled={!databaseReady}
          onClick={() => setDialogOpen(true)}
        >
          <PlusIcon />
          새 상품 등록
        </button>
      </section>

      {!databaseReady && (
        <div className={styles.setupNotice} role="status">
          <DatabaseIcon />
          <div>
            <strong>현재 상품 정보를 수정할 수 없습니다.</strong>
            <p>{sourceMessage}</p>
          </div>
        </div>
      )}

      {FREE_ENROLLMENT_MODE && (
        <div className={styles.freeModeNotice} role="status">
          <span aria-hidden="true">₩</span>
          <div>
            <strong>결제 연동 전 무료 신청 모드입니다.</strong>
            <p>현재 모든 강의와 전자책은 0원으로만 저장되며, 수강신청 즉시 이용권이 발급됩니다.</p>
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

      <section className={styles.summaryBar} aria-label="상품 상태 요약">
        <SummaryItem label="전체 상품" value={summary.total} />
        <SummaryItem label="판매 중" value={summary.active} tone="active" />
        <SummaryItem label="작성 중" value={summary.draft} />
        <SummaryItem label="판매 중지 · 보관" value={summary.unavailable} />
      </section>

      <section className={styles.productPanel} aria-labelledby="product-list-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="product-list-title">상품 목록</h2>
            <p>삭제 대신 판매 중지 또는 보관 상태로 변경해 주문 기록을 유지합니다.</p>
          </div>
          <span className={databaseReady ? styles.databaseBadge : styles.catalogBadge}>
            <span aria-hidden="true" />
            {databaseReady ? "운영 데이터" : "읽기 전용"}
          </span>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.typeFilters} aria-label="상품 유형 필터">
            {typeFilters.map((filter) => (
              <button
                type="button"
                key={filter.value}
                className={typeFilter === filter.value ? styles.filterActive : styles.filter}
                onClick={() => setTypeFilter(filter.value)}
                aria-pressed={typeFilter === filter.value}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className={styles.toolbarControls}>
            <label className={styles.searchField}>
              <SearchIcon />
              <span className={styles.visuallyHidden}>상품 검색</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="상품명 또는 주소 검색"
              />
            </label>
            <label className={styles.statusSelect}>
              <span className={styles.visuallyHidden}>상품 상태</span>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
              >
                {statusOptions.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronIcon />
            </label>
          </div>
        </div>

        {filteredProducts.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.productTable}>
              <thead>
                <tr>
                  <th>상품</th>
                  <th>유형</th>
                  <th>판매가</th>
                  <th>이용 기간</th>
                  <th>상태</th>
                  <th>최근 수정</th>
                  <th><span className={styles.visuallyHidden}>상품 작업</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => (
                  <ProductRow
                    key={product.id}
                    product={product}
                    databaseReady={databaseReady}
                    saving={savingProductId === product.id}
                    onStatusChange={updateStatus}
                    onEdit={setEditingProduct}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <SearchIcon />
            <strong>조건에 맞는 상품이 없습니다.</strong>
            <p>검색어 또는 필터를 변경해 보세요.</p>
          </div>
        )}
      </section>

      {dialogOpen && (
        <ProductCreateDialog onClose={() => setDialogOpen(false)} />
      )}
      {editingProduct && (
        <ProductEditDialog
          key={editingProduct.id}
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
        />
      )}
    </div>
  );
}

function SummaryItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "active";
}) {
  return (
    <div className={styles.summaryItem}>
      <span>{label}</span>
      <strong className={tone ? styles.summaryValueActive : undefined}>
        {value}<small>개</small>
      </strong>
    </div>
  );
}

function ProductRow({
  product,
  databaseReady,
  saving,
  onStatusChange,
  onEdit,
}: {
  product: AdminProduct;
  databaseReady: boolean;
  saving: boolean;
  onStatusChange: (
    product: AdminProduct,
    nextStatus: AdminProductStatus
  ) => Promise<void>;
  onEdit: (product: AdminProduct) => void;
}) {
  const nextAction = getNextStatusAction(product.status);
  const canEdit = databaseReady && product.source === "database";
  const canUpdateStatus = canEdit && nextAction;

  return (
    <tr>
      <td>
        <div className={styles.productIdentity}>
          <span className={styles.productThumbnail} aria-hidden="true">
            {product.productType === "course" ? <PlayIcon /> : <BookIcon />}
          </span>
          <span className={styles.productCopy}>
            <strong>{product.title}</strong>
            <span>/{product.slug}</span>
          </span>
        </div>
      </td>
      <td data-label="유형">{formatProductType(product.productType)}</td>
      <td data-label="판매가" className={styles.priceCell}>
        {formatPrice(product.priceKrw)}
      </td>
      <td data-label="이용 기간">{formatAccessPeriod(product.accessPeriodDays)}</td>
      <td data-label="상태">
        <span className={`${styles.statusBadge} ${styles[product.status]}`}>
          {formatStatus(product.status)}
        </span>
      </td>
      <td data-label="최근 수정" className={styles.dateCell}>
        {formatUpdatedAt(product.updatedAt)}
      </td>
      <td className={styles.actionCell}>
        {canEdit ? (
          <span className={styles.rowActions}>
            {canUpdateStatus && (
              <button
                type="button"
                className={styles.rowAction}
                disabled={saving}
                onClick={() => onStatusChange(product, nextAction.status)}
              >
                {saving ? "변경 중" : nextAction.label}
              </button>
            )}
            <button
              type="button"
              className={`${styles.rowAction} ${styles.editAction}`}
              disabled={saving}
              onClick={() => onEdit(product)}
            >
              수정
            </button>
          </span>
        ) : product.detailPath ? (
          <Link href={product.detailPath} className={styles.rowLink}>
            보기
          </Link>
        ) : (
          <span className={styles.noAction}>—</span>
        )}
      </td>
    </tr>
  );
}

function ProductEditDialog({
  product,
  onClose,
}: {
  product: AdminProduct;
  onClose: () => void;
}) {
  const updateAction = useMemo(
    () => updateProductAction.bind(null, product.id),
    [product.id]
  );
  const [state, formAction, pending] = useActionState(
    updateAction,
    initialCreateProductState
  );
  const [accessMode, setAccessMode] = useState<"period" | "lifetime">(
    product.accessPeriodDays ? "period" : "lifetime"
  );
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
        aria-labelledby="edit-product-title"
        aria-describedby="edit-product-description"
      >
        <header className={styles.dialogHeader}>
          <div>
            <span>EDIT PRODUCT</span>
            <h2 id="edit-product-title">상품 정보 수정</h2>
            <p id="edit-product-description">
              판매 정보 변경은 즉시 반영됩니다. 저장 전 상태와 가격을 확인해 주세요.
            </p>
          </div>
          <button
            autoFocus
            type="button"
            className={styles.dialogClose}
            onClick={onClose}
            disabled={pending}
            aria-label="상품 수정 창 닫기"
          >
            <CloseIcon />
          </button>
        </header>

        {state.status === "success" ? (
          <div className={styles.successState} role="status">
            <span><CheckIcon /></span>
            <strong>{state.message}</strong>
            <p>상품 목록과 공개 판매 상태에 변경 내용이 반영되었습니다.</p>
            <button type="button" onClick={onClose}>목록으로 돌아가기</button>
          </div>
        ) : (
          <form
            action={formAction}
            className={styles.productForm}
            onSubmit={(event) => {
              const form = event.currentTarget;
              const nextStatus = new FormData(form).get("status");
              if (
                nextStatus !== product.status &&
                !window.confirm(getStatusConfirmMessage(product, String(nextStatus) as AdminProductStatus))
              ) {
                event.preventDefault();
              }
            }}
          >
            {state.status === "error" && (
              <div className={styles.formError} role="alert">
                {state.message}
              </div>
            )}

            <div className={styles.lockedProductMeta}>
              <div>
                <span>상품 유형</span>
                <strong>{formatProductType(product.productType)}</strong>
              </div>
              <div>
                <span>상품 주소</span>
                <strong>/{product.slug}</strong>
              </div>
              <small>주문 및 콘텐츠 연결을 보호하기 위해 두 항목은 변경할 수 없습니다.</small>
            </div>

            <div className={styles.formGrid}>
              <FormField
                label="상품명"
                name="title"
                defaultValue={product.title}
                error={state.fieldErrors.title}
                required
              />
              <FormField
                label="판매가"
                name="priceKrw"
                type="number"
                inputMode="numeric"
                min="0"
                step="1000"
                suffix="원"
                defaultValue={String(product.priceKrw)}
                error={state.fieldErrors.priceKrw}
                description="무료 신청 모드에서는 0원으로 고정됩니다."
                readOnly={FREE_ENROLLMENT_MODE}
                required
              />
            </div>

            <label className={styles.formField}>
              <span>상품 설명</span>
              <textarea
                name="summary"
                rows={3}
                maxLength={500}
                defaultValue={product.summary}
                aria-invalid={Boolean(state.fieldErrors.summary)}
                aria-describedby={state.fieldErrors.summary ? "edit-summary-error" : undefined}
              />
              {state.fieldErrors.summary && (
                <small id="edit-summary-error" className={styles.fieldError}>
                  {state.fieldErrors.summary}
                </small>
              )}
            </label>

            <div className={styles.formGrid}>
              <label className={styles.formField}>
                <span>판매 상태</span>
                <span className={styles.selectControl}>
                  <select name="status" defaultValue={product.status}>
                    <option value="draft">작성 중</option>
                    <option value="active">판매 중</option>
                    <option value="paused">판매 중지</option>
                    <option value="archived">보관</option>
                  </select>
                  <ChevronIcon />
                </span>
                <small>판매 중 상태만 공개 상품 목록에 표시됩니다.</small>
              </label>

              <fieldset className={`${styles.accessFieldset} ${styles.editAccessFieldset}`}>
                <legend>이용 기간</legend>
                <div className={styles.editAccessControl}>
                  <div className={styles.accessChoices}>
                    <label>
                      <input
                        type="radio"
                        name="accessMode"
                        value="period"
                        checked={accessMode === "period"}
                        onChange={handleAccessMode(setAccessMode)}
                      />
                      <span>기간제</span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="accessMode"
                        value="lifetime"
                        checked={accessMode === "lifetime"}
                        onChange={handleAccessMode(setAccessMode)}
                      />
                      <span>제한 없음</span>
                    </label>
                  </div>
                  {accessMode === "period" && (
                    <label className={styles.durationField}>
                      <input
                        type="number"
                        name="accessPeriodDays"
                        min="1"
                        defaultValue={product.accessPeriodDays ?? 365}
                        aria-label="이용 기간 일수"
                        aria-describedby={
                          state.fieldErrors.accessPeriodDays
                            ? "edit-access-days-error"
                            : undefined
                        }
                      />
                      <span>일</span>
                    </label>
                  )}
                </div>
                {state.fieldErrors.accessPeriodDays && (
                  <small id="edit-access-days-error" className={styles.fieldError}>
                    {state.fieldErrors.accessPeriodDays}
                  </small>
                )}
              </fieldset>
            </div>

            <details className={styles.advancedFields}>
              <summary>이미지·상세 페이지 경로</summary>
              <div className={styles.formGrid}>
                <FormField
                  label="썸네일 경로"
                  name="thumbnailPath"
                  defaultValue={product.thumbnailPath ?? ""}
                  placeholder="/assets/product-cover.jpg"
                  error={state.fieldErrors.thumbnailPath}
                />
                <FormField
                  label="상세 페이지 경로"
                  name="detailPath"
                  defaultValue={product.detailPath ?? ""}
                  placeholder="/courses/product-slug"
                  error={state.fieldErrors.detailPath}
                />
              </div>
            </details>

            <div className={styles.dialogActions}>
              <button type="button" className={styles.cancelButton} onClick={onClose} disabled={pending}>
                취소
              </button>
              <button type="submit" className={styles.submitButton} disabled={pending}>
                {pending ? "저장 중..." : "변경 내용 저장"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
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

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href]'
        )
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);

      if (!firstElement || !lastElement) return;

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleDialogKeyDown);
    };
  }, [dialogRef, onClose, pending]);
}

function ProductCreateDialog({ onClose }: { onClose: () => void }) {
  const [state, formAction, pending] = useActionState(
    createProductAction,
    initialCreateProductState
  );
  const [accessMode, setAccessMode] = useState<"period" | "lifetime">("period");
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
        aria-labelledby="create-product-title"
        aria-describedby="create-product-description"
      >
        <header className={styles.dialogHeader}>
          <div>
            <span>NEW PRODUCT</span>
            <h2 id="create-product-title">새 상품 등록</h2>
            <p id="create-product-description">
              판매 단위를 먼저 만들고, 다음 단계에서 강의 또는 전자책 콘텐츠를 연결합니다.
            </p>
          </div>
          <button
            autoFocus
            type="button"
            className={styles.dialogClose}
            onClick={onClose}
            disabled={pending}
            aria-label="새 상품 등록 창 닫기"
          >
            <CloseIcon />
          </button>
        </header>

        {state.status === "success" ? (
          <div className={styles.successState} role="status">
            <span><CheckIcon /></span>
            <strong>{state.message}</strong>
            <p>상품 목록에 반영되었습니다. 콘텐츠 연결은 강의 관리 단계에서 진행합니다.</p>
            <button type="button" onClick={onClose}>목록으로 돌아가기</button>
          </div>
        ) : (
          <form action={formAction} className={styles.productForm}>
            {state.status === "error" && (
              <div className={styles.formError} role="alert">
                {state.message}
              </div>
            )}

            <fieldset className={styles.typeChoice}>
              <legend>상품 유형</legend>
              <label>
                <input type="radio" name="productType" value="course" defaultChecked />
                <span><PlayIcon /><strong>VOD 강의</strong><small>영상 커리큘럼 연결</small></span>
              </label>
              <label>
                <input type="radio" name="productType" value="ebook" />
                <span><BookIcon /><strong>전자책</strong><small>파일 또는 리더 연결</small></span>
              </label>
            </fieldset>

            <div className={styles.formGrid}>
              <FormField
                label="상품명"
                name="title"
                placeholder="예: 이윰 SNS 수익화 클래스"
                error={state.fieldErrors.title}
                required
              />
              <FormField
                label="상품 주소"
                name="slug"
                placeholder="예: sns-monetization"
                description="영문 소문자, 숫자와 하이픈만 사용"
                error={state.fieldErrors.slug}
                required
              />
              <FormField
                label="판매가"
                name="priceKrw"
                type="number"
                inputMode="numeric"
                min="0"
                step="1000"
                placeholder="300000"
                suffix="원"
                defaultValue={FREE_ENROLLMENT_MODE ? "0" : undefined}
                error={state.fieldErrors.priceKrw}
                description="무료 신청 모드에서는 0원으로 고정됩니다."
                readOnly={FREE_ENROLLMENT_MODE}
                required
              />
              <label className={styles.formField}>
                <span>등록 상태</span>
                <span className={styles.selectControl}>
                  <select name="status" defaultValue="draft">
                    <option value="draft">작성 중</option>
                    <option value="active">판매 중</option>
                  </select>
                  <ChevronIcon />
                </span>
                <small>검수 전에는 작성 중을 권장합니다.</small>
              </label>
            </div>

            <label className={styles.formField}>
              <span>상품 설명</span>
              <textarea
                name="summary"
                rows={3}
                maxLength={500}
                placeholder="상품 목록과 결제 화면에 표시할 설명을 입력하세요."
                aria-describedby={state.fieldErrors.summary ? "summary-error" : undefined}
              />
              {state.fieldErrors.summary && (
                <small id="summary-error" className={styles.fieldError}>
                  {state.fieldErrors.summary}
                </small>
              )}
            </label>

            <fieldset className={styles.accessFieldset}>
              <legend>이용 기간</legend>
              <div className={styles.accessChoices}>
                <label>
                  <input
                    type="radio"
                    name="accessMode"
                    value="period"
                    checked={accessMode === "period"}
                    onChange={handleAccessMode(setAccessMode)}
                  />
                  <span>기간제</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="accessMode"
                    value="lifetime"
                    checked={accessMode === "lifetime"}
                    onChange={handleAccessMode(setAccessMode)}
                  />
                  <span>기간 제한 없음</span>
                </label>
              </div>
              {accessMode === "period" && (
                <label className={styles.durationField}>
                  <input
                    type="number"
                    name="accessPeriodDays"
                    min="1"
                    defaultValue="365"
                    aria-label="이용 기간 일수"
                    aria-describedby={
                      state.fieldErrors.accessPeriodDays ? "access-days-error" : undefined
                    }
                  />
                  <span>일</span>
                </label>
              )}
              {state.fieldErrors.accessPeriodDays && (
                <small id="access-days-error" className={styles.fieldError}>
                  {state.fieldErrors.accessPeriodDays}
                </small>
              )}
            </fieldset>

            <details className={styles.advancedFields}>
              <summary>이미지·상세 페이지 경로</summary>
              <div className={styles.formGrid}>
                <FormField
                  label="썸네일 경로"
                  name="thumbnailPath"
                  placeholder="/assets/product-cover.jpg"
                  error={state.fieldErrors.thumbnailPath}
                />
                <FormField
                  label="상세 페이지 경로"
                  name="detailPath"
                  placeholder="/courses/product-slug"
                  error={state.fieldErrors.detailPath}
                />
              </div>
            </details>

            <div className={styles.dialogActions}>
              <button type="button" className={styles.cancelButton} onClick={onClose} disabled={pending}>
                취소
              </button>
              <button type="submit" className={styles.submitButton} disabled={pending}>
                {pending ? "저장 중..." : "상품 등록"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

type FormFieldProps = {
  label: string;
  name: string;
  type?: "text" | "number";
  inputMode?: "text" | "numeric";
  min?: string;
  step?: string;
  placeholder?: string;
  description?: string;
  suffix?: string;
  error?: string;
  required?: boolean;
  defaultValue?: string;
  readOnly?: boolean;
};

function FormField({
  label,
  name,
  type = "text",
  inputMode = "text",
  min,
  step,
  placeholder,
  description,
  suffix,
  error,
  required,
  defaultValue,
  readOnly,
}: FormFieldProps) {
  const errorId = `${name}-error`;
  const descriptionId = `${name}-description`;
  const describedBy = error ? errorId : description ? descriptionId : undefined;

  return (
    <label className={styles.formField}>
      <span>{label}</span>
      <span className={styles.inputControl}>
        <input
          type={type}
          inputMode={inputMode}
          name={name}
          min={min}
          step={step}
          placeholder={placeholder}
          required={required}
          defaultValue={defaultValue}
          readOnly={readOnly}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        />
        {suffix && <span>{suffix}</span>}
      </span>
      {error ? (
        <small id={errorId} className={styles.fieldError}>{error}</small>
      ) : description ? (
        <small id={descriptionId}>{description}</small>
      ) : null}
    </label>
  );
}

function handleAccessMode(
  setter: (value: "period" | "lifetime") => void
) {
  return (event: ChangeEvent<HTMLInputElement>) => {
    setter(event.target.value === "lifetime" ? "lifetime" : "period");
  };
}

function getNextStatusAction(status: AdminProductStatus) {
  const actions: Partial<
    Record<AdminProductStatus, { label: string; status: AdminProductStatus }>
  > = {
    draft: { label: "판매 시작", status: "active" },
    active: { label: "판매 중지", status: "paused" },
    paused: { label: "판매 재개", status: "active" },
  };
  return actions[status] ?? null;
}

function getStatusConfirmMessage(product: AdminProduct, nextStatus: AdminProductStatus) {
  if (nextStatus === "active") {
    return `‘${product.title}’을 판매 중으로 변경할까요?\n사용자 상품 목록과 수강신청 화면에 즉시 노출됩니다.`;
  }
  if (nextStatus === "paused") {
    return `‘${product.title}’ 판매를 중지할까요?\n기존 수강권은 유지되지만 신규 수강신청은 중단됩니다.`;
  }
  if (nextStatus === "archived") {
    return `‘${product.title}’을 보관할까요?\n판매 페이지에서 숨겨지며 신규 수강신청이 중단됩니다.`;
  }
  return `‘${product.title}’을 작성 중 상태로 변경할까요?\n판매 페이지에서 즉시 숨겨집니다.`;
}

function formatProductType(type: AdminProductType) {
  return type === "course" ? "VOD 강의" : "전자책";
}

function formatStatus(status: AdminProductStatus) {
  const labels: Record<AdminProductStatus, string> = {
    draft: "작성 중",
    active: "판매 중",
    paused: "판매 중지",
    archived: "보관",
  };
  return labels[status];
}

function formatPrice(price: number) {
  return `${new Intl.NumberFormat("ko-KR").format(price)}원`;
}

function formatAccessPeriod(days: number | null) {
  return days ? `${new Intl.NumberFormat("ko-KR").format(days)}일` : "기간 제한 없음";
}

function formatUpdatedAt(value: string | null) {
  if (!value) return "코드 기준";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function PlusIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>;
}

function SearchIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="m12.5 12.5 4 4" /></svg>;
}

function CloseIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>;
}

function ChevronIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6.5 8 3.5 3.5L13.5 8" /></svg>;
}

function PlayIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3V9Z" /></svg>;
}

function BookIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h9a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5Z" /><path d="M17 7.5h2a2 2 0 0 1 2 2V20h-4" /></svg>;
}

function DatabaseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 10v6M12 7h.01" /></svg>;
}

function CheckIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 3 3 7-7" /></svg>;
}
