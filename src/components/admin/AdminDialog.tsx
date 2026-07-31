"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { CloseIcon } from "./icons";
import styles from "./AdminDialog.module.css";

/**
 * 관리자 화면의 단일 모달 셸.
 *
 * 이전에는 화면마다 div[role=dialog] + 수동 포커스 트랩(useDialogBehavior)을
 * 복사해 쓰다 보니 파일별로 포커스 대상 셀렉터가 조금씩 달랐다. 여기서는
 * 네이티브 <dialog>.showModal()에 포커스 트랩과 inert 처리를 위임한다.
 *
 * 초기 포커스는 닫기 버튼이 아니라 제목이다. 모달을 연 사람이 가장 먼저
 * 들어야 하는 정보가 "이 창이 무엇인지"이기 때문이다.
 */
export default function AdminDialog({
  eyebrow,
  title,
  description,
  busy = false,
  size = "medium",
  onClose,
  footer,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  /** 저장 중처럼 닫으면 안 되는 상태. ESC와 배경 클릭을 막는다. */
  busy?: boolean;
  size?: "small" | "medium" | "large";
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!dialog.open) dialog.showModal();
    headingRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${styles[size]}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        // 네이티브 ESC 닫기를 가로채 저장 중에는 무시한다.
        event.preventDefault();
        if (!busy) onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === dialogRef.current && !busy) onClose();
      }}
    >
      <div className={styles.frame}>
        <header className={styles.header}>
          <div>
            {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
            <h2 id={titleId} ref={headingRef} tabIndex={-1}>
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className={styles.description}>
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            disabled={busy}
            aria-label={`${title} 창 닫기`}
          >
            <CloseIcon />
          </button>
        </header>

        <div className={styles.body}>{children}</div>

        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </dialog>
  );
}

/** 모달 하단 취소/실행 버튼 쌍. 실행 버튼이 오른쪽에 오는 순서를 통일한다. */
export function AdminDialogActions({
  busy,
  disabled = false,
  onClose,
  submitLabel,
  busyLabel = "저장 중...",
  tone = "default",
  onSubmit,
}: {
  busy: boolean;
  disabled?: boolean;
  onClose: () => void;
  submitLabel: string;
  busyLabel?: string;
  tone?: "default" | "danger";
  /** 생략하면 type="submit"으로 감싼 form에 제출한다. */
  onSubmit?: () => void;
}) {
  return (
    <div className={styles.actions}>
      <button type="button" className={styles.cancel} onClick={onClose} disabled={busy}>
        취소
      </button>
      <button
        type={onSubmit ? "button" : "submit"}
        className={tone === "danger" ? styles.danger : styles.submit}
        onClick={onSubmit}
        disabled={busy || disabled}
      >
        {busy ? busyLabel : submitLabel}
      </button>
    </div>
  );
}
