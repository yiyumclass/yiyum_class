"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  createDetailItemAction,
  deleteDetailItemAction,
  swapDetailItemOrderAction,
  updateDetailItemAction,
} from "@/app/admin/products/detail-item-actions";
import {
  removeProductFileAction,
  saveProductFileAction,
} from "@/app/admin/products/file-actions";
import {
  removeProductPagesAction,
  saveProductPagesAction,
  updatePreviewPageCountAction,
} from "@/app/admin/products/page-actions";
import type {
  AdminProduct,
  AdminProductDetailItem,
} from "@/lib/admin/products";
import { renderPdfPages } from "@/lib/admin/pdf-pages";
import { createClient } from "@/lib/supabase/client";
import AdminDialog from "./AdminDialog";
import { useAdminFeedback } from "./AdminFeedback";
import styles from "./AdminProductDetailDialog.module.css";

const FILE_BUCKET = "product-files";
const MAX_FILE_BYTES = 50 * 1024 * 1024;

type UploadPhase = "idle" | "uploading" | "converting" | "saving";

export default function AdminProductDetailDialog({
  product,
  initialItems,
  onClose,
}: {
  product: AdminProduct;
  initialItems: AdminProductDetailItem[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast, confirm } = useAdminFeedback();
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState({ title: "", body: "" });
  const [convertProgress, setConvertProgress] = useState({ done: 0, total: 0 });
  const [previewPages, setPreviewPages] = useState(
    String(product.previewPageCount)
  );

  // 항목 목록은 서버가 준 것만 믿는다. 새로 만든 줄에 가짜 id를 붙여 두면
  // 그 줄을 곧바로 수정하거나 지울 때 서버가 알아보지 못한다.
  const items = initialItems;
  const busy = phase !== "idle" || pending;

  const handleUpload = async (chosen: File) => {
    if (chosen.size > MAX_FILE_BYTES) {
      toast("자료 파일은 50MB 이하만 올릴 수 있습니다.", "error");
      return;
    }

    setPhase("uploading");
    try {
      const supabase = createClient();
      const objectPath = buildFilePath(product.slug, chosen.name);

      const { error } = await supabase.storage
        .from(FILE_BUCKET)
        .upload(objectPath, chosen, {
          contentType: chosen.type || "application/octet-stream",
          upsert: false,
        });

      if (error) throw new Error(error.message);

      setPhase("saving");
      const result = await saveProductFileAction(product.id, {
        path: objectPath,
        name: chosen.name,
        contentType: chosen.type || "application/octet-stream",
        sizeBytes: chosen.size,
      });

      if (!result.ok) {
        toast(result.message, "error");
        return;
      }

      toast(result.message, "success");

      // 미리보기 변환은 여기서부터 따로 실패할 수 있다. 자료는 이미 연결된
      // 뒤라, 한데 묶어 "실패"라고 알리면 멀쩡히 올라간 파일을 다시 올리게 된다.
      if (isPdf(chosen)) {
        try {
          await convertPages(chosen);
        } catch (error) {
          console.error("Failed to build product page previews:", error);
          toast(
            "자료는 올라갔지만 미리보기 페이지를 만들지 못했습니다. 아래 미리보기 만들기로 다시 시도해 주세요.",
            "error"
          );
        }
      }

      router.refresh();
    } catch (error) {
      console.error("Failed to upload product file:", error);
      toast("자료를 올리지 못했습니다. 잠시 후 다시 시도해 주세요.", "error");
    } finally {
      setPhase("idle");
      setConvertProgress({ done: 0, total: 0 });
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const convertPages = async (chosen: File) => {
    setPhase("converting");
    const supabase = createClient();
    const rendered = await renderPdfPages(chosen, (done, total) =>
      setConvertProgress({ done, total })
    );

    const pageFolder = buildPageFolder(product.slug);
    const uploaded = [];
    for (const page of rendered) {
      const objectPath = `${pageFolder}/${String(page.pageNumber).padStart(3, "0")}.jpg`;
      const { error } = await supabase.storage
        .from(FILE_BUCKET)
        .upload(objectPath, page.blob, {
          contentType: "image/jpeg",
          upsert: false,
        });
      if (error) throw new Error(error.message);
      uploaded.push({
        pageNumber: page.pageNumber,
        imagePath: objectPath,
        width: page.width,
        height: page.height,
      });
    }

    setPhase("saving");
    const desiredPreview = Number(previewPages);
    const result = await saveProductPagesAction(
      product.id,
      uploaded,
      Number.isFinite(desiredPreview) ? desiredPreview : 0
    );
    toast(result.message, result.ok ? "success" : "error");
  };

  /**
   * 파일은 그대로 두고 미리보기 페이지만 다시 만든다.
   *
   * 변환은 브라우저가 하는데 새로고침하면 원본 바이트가 사라진다. 그래서 같은
   * PDF 를 다시 고르게 한다. 파일 기록은 건드리지 않으므로 내려받기는 그대로다.
   */
  const handleConvertOnly = async (chosen: File) => {
    if (!isPdf(chosen)) {
      toast("미리보기는 PDF 에서만 만들 수 있습니다.", "error");
      return;
    }

    try {
      await convertPages(chosen);
      router.refresh();
    } catch (error) {
      console.error("Failed to build product page previews:", error);
      toast("미리보기 페이지를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", "error");
    } finally {
      setPhase("idle");
      setConvertProgress({ done: 0, total: 0 });
      if (pageInputRef.current) pageInputRef.current.value = "";
    }
  };

  const handleRemoveFile = async () => {
    const confirmed = await confirm({
      title: "자료 파일을 삭제할까요?",
      description:
        "이미 신청한 회원도 더 이상 내려받을 수 없습니다. 파일은 되돌릴 수 없습니다.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!confirmed) return;

    startTransition(async () => {
      const result = await removeProductFileAction(product.id);
      toast(result.message, result.ok ? "success" : "error");
      if (result.ok) router.refresh();
    });
  };

  const handleSavePreviewCount = () => {
    const parsed = Number(previewPages);
    if (!Number.isInteger(parsed) || parsed < 0) {
      toast("미리보기 장수는 0 이상의 숫자로 입력해 주세요.", "error");
      return;
    }
    startTransition(async () => {
      const result = await updatePreviewPageCountAction(product.id, parsed);
      toast(result.message, result.ok ? "success" : "error");
      if (result.ok) router.refresh();
    });
  };

  const handleRemovePages = async () => {
    const confirmed = await confirm({
      title: "미리보기 페이지를 삭제할까요?",
      description:
        "상세 페이지에서 자료를 미리 볼 수 없게 됩니다. 원본 파일은 그대로 남습니다.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!confirmed) return;

    startTransition(async () => {
      const result = await removeProductPagesAction(product.id);
      toast(result.message, result.ok ? "success" : "error");
      if (result.ok) router.refresh();
    });
  };

  const handleAddItem = () => {
    if (!draft.title.trim()) {
      toast("항목 제목을 입력해 주세요.", "error");
      return;
    }
    startTransition(async () => {
      const result = await createDetailItemAction(product.id, draft);
      toast(result.message, result.ok ? "success" : "error");
      if (!result.ok) return;
      setDraft({ title: "", body: "" });
      router.refresh();
    });
  };

  return (
    <AdminDialog
      eyebrow="PRODUCT DETAIL"
      title="자료 구성"
      description="상세 페이지에 표시할 자료 파일과 안내 항목을 관리합니다."
      size="large"
      busy={busy}
      onClose={onClose}
    >
      <section className={styles.block} aria-labelledby="detail-file-title">
        <h3 id="detail-file-title">자료 파일</h3>
        <p className={styles.hint}>
          신청한 회원만 내려받을 수 있습니다. 주소는 매번 새로 발급되고 곧 만료됩니다.
          PDF를 올리면 페이지 이미지를 함께 만들어 상세에서 미리 볼 수 있게 합니다.
        </p>

        {product.file ? (
          <div className={styles.fileRow}>
            <div className={styles.fileMeta}>
              <strong>{product.file.name}</strong>
              <span>
                {formatBytes(product.file.sizeBytes)} ·{" "}
                {formatUploadedAt(product.file.uploadedAt)}
              </span>
            </div>
            <div className={styles.fileActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={busy}
                onClick={() => pageInputRef.current?.click()}
              >
                {phase === "converting"
                  ? `변환 중 ${convertProgress.done}/${convertProgress.total}`
                  : product.pageCount > 0
                    ? "미리보기 다시 만들기"
                    : "미리보기 만들기"}
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                교체
              </button>
              <button
                type="button"
                className={styles.dangerButton}
                disabled={busy}
                onClick={handleRemoveFile}
              >
                삭제
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.emptyFile}>
            <p>아직 올린 자료가 없습니다.</p>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {phase === "uploading"
                ? "올리는 중"
                : phase === "converting"
                  ? `페이지 변환 중 ${convertProgress.done}/${convertProgress.total}`
                  : phase === "saving"
                    ? "연결 중"
                    : "자료 올리기"}
            </button>
          </div>
        )}

        {product.pageCount > 0 && (
          <div className={styles.previewRow}>
            <div className={styles.fileMeta}>
              <strong>미리보기 {product.previewPageCount}장 / 전체 {product.pageCount}장</strong>
              <span>
                앞쪽 이만큼은 로그인하지 않아도 보입니다. 나머지는 신청한 회원에게만 열립니다.
              </span>
            </div>
            <div className={styles.fileActions}>
              <label className={styles.previewInput}>
                <span className={styles.visuallyHidden}>미리보기 장수</span>
                <input
                  type="number"
                  min={0}
                  max={product.pageCount}
                  value={previewPages}
                  disabled={busy}
                  onChange={(event) => setPreviewPages(event.target.value)}
                />
              </label>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={busy}
                onClick={handleSavePreviewCount}
              >
                저장
              </button>
              <button
                type="button"
                className={styles.dangerButton}
                disabled={busy}
                onClick={handleRemovePages}
              >
                페이지 삭제
              </button>
            </div>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.zip,.docx,.xlsx,.pptx"
          className={styles.hiddenInput}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) void handleUpload(chosen);
          }}
        />
        <input
          ref={pageInputRef}
          type="file"
          accept=".pdf"
          className={styles.hiddenInput}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) void handleConvertOnly(chosen);
          }}
        />
      </section>

      <section className={styles.block} aria-labelledby="detail-items-title">
        <h3 id="detail-items-title">이런 게 들어있어요</h3>
        <p className={styles.hint}>
          상세 페이지에 순서대로 표시됩니다. 제목만 있어도 되고, 설명을 덧붙여도 됩니다.
        </p>

        {items.length > 0 ? (
          <ol className={styles.itemList}>
            {items.map((item, index) => (
              <DetailItemRow
                key={item.id}
                item={item}
                index={index}
                total={items.length}
                busy={busy}
              />
            ))}
          </ol>
        ) : (
          <p className={styles.emptyItems}>아직 등록한 항목이 없습니다.</p>
        )}

        <div className={styles.draft}>
          <label>
            <span>항목 제목</span>
            <input
              type="text"
              value={draft.title}
              maxLength={120}
              placeholder="예: 협찬 단가표 템플릿"
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, title: event.target.value }))
              }
            />
          </label>
          <label>
            <span>설명 (선택)</span>
            <textarea
              rows={2}
              value={draft.body}
              maxLength={500}
              placeholder="예: 팔로워 구간별 적정 단가를 바로 채워 쓸 수 있어요."
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, body: event.target.value }))
              }
            />
          </label>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={busy}
            onClick={handleAddItem}
          >
            항목 추가
          </button>
        </div>
      </section>
    </AdminDialog>
  );
}

function DetailItemRow({
  item,
  index,
  total,
  busy,
}: {
  item: AdminProductDetailItem;
  index: number;
  total: number;
  busy: boolean;
}) {
  const router = useRouter();
  const { toast, confirm } = useAdminFeedback();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({ title: item.title, body: item.body });
  const [pending, startTransition] = useTransition();

  const disabled = busy || pending;

  // 편집을 열 때마다 서버가 준 최신 값으로 채운다. effect 로 되돌리면 저장 직후
  // 목록이 갱신되는 사이에 입력 중이던 값이 덮여 사라진다.
  const startEditing = () => {
    setValues({ title: item.title, body: item.body });
    setEditing(true);
  };

  const save = () => {
    startTransition(async () => {
      const result = await updateDetailItemAction(item.id, values);
      toast(result.message, result.ok ? "success" : "error");
      if (!result.ok) return;
      setEditing(false);
      router.refresh();
    });
  };

  const remove = async () => {
    const confirmed = await confirm({
      title: "항목을 삭제할까요?",
      description: item.title,
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!confirmed) return;

    startTransition(async () => {
      const result = await deleteDetailItemAction(item.id);
      toast(result.message, result.ok ? "success" : "error");
      if (result.ok) router.refresh();
    });
  };

  const move = (direction: "up" | "down") => {
    startTransition(async () => {
      const result = await swapDetailItemOrderAction(item.id, direction);
      if (!result.ok) {
        toast(result.message, "error");
        return;
      }
      router.refresh();
    });
  };

  return (
    <li className={styles.item}>
      <span className={styles.itemNumber}>{String(index + 1).padStart(2, "0")}</span>

      {editing ? (
        <div className={styles.itemEdit}>
          <input
            type="text"
            value={values.title}
            maxLength={120}
            onChange={(event) =>
              setValues((prev) => ({ ...prev, title: event.target.value }))
            }
          />
          <textarea
            rows={2}
            value={values.body}
            maxLength={500}
            onChange={(event) =>
              setValues((prev) => ({ ...prev, body: event.target.value }))
            }
          />
          <div className={styles.itemActions}>
            <button type="button" className={styles.primaryButton} disabled={disabled} onClick={save}>
              저장
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={disabled}
              onClick={() => {
                setValues({ title: item.title, body: item.body });
                setEditing(false);
              }}
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.itemBody}>
          <strong>{item.title}</strong>
          {item.body && <p>{item.body}</p>}
        </div>
      )}

      {!editing && (
        <div className={styles.itemActions}>
          <button
            type="button"
            className={styles.iconButton}
            disabled={disabled || index === 0}
            aria-label="위로 옮기기"
            onClick={() => move("up")}
          >
            ↑
          </button>
          <button
            type="button"
            className={styles.iconButton}
            disabled={disabled || index === total - 1}
            aria-label="아래로 옮기기"
            onClick={() => move("down")}
          >
            ↓
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={disabled}
            onClick={startEditing}
          >
            수정
          </button>
          <button
            type="button"
            className={styles.dangerButton}
            disabled={disabled}
            onClick={remove}
          >
            삭제
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * 객체 키를 만든다.
 *
 * 렌더 밖에 두는 이유는 시각을 읽는 함수라서다. 컴포넌트 안에서 부르면
 * 다시 그릴 때마다 값이 달라져 규칙 검사에 걸린다.
 */
function buildFilePath(slug: string, fileName: string) {
  // 이름에 한글이나 공백이 있으면 객체 키로 쓰기 어렵다. 원본 이름은 따로 적어둔다.
  const extension = fileName.includes(".")
    ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase()
    : "";
  return `${slug}/${Date.now()}${extension}`;
}

function buildPageFolder(slug: string) {
  return `${slug}/pages/${Date.now()}`;
}

function isPdf(file: File) {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

function formatBytes(value: number | null) {
  if (!value) return "크기 정보 없음";
  const mb = value / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)}MB`;
  return `${Math.max(1, Math.round(value / 1024))}KB`;
}

function formatUploadedAt(value: string | null) {
  if (!value) return "업로드 시각 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}
