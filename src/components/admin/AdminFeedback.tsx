"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import AdminDialog, { AdminDialogActions } from "./AdminDialog";
import { AlertIcon, CheckIcon, CloseIcon } from "./icons";
import styles from "./AdminFeedback.module.css";

export type ToastTone = "success" | "error" | "info";

type Toast = {
  id: number;
  tone: ToastTone;
  message: string;
};

type ConfirmRequest = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

type PendingConfirm = ConfirmRequest & { resolve: (confirmed: boolean) => void };

type AdminFeedbackValue = {
  toast: (message: string, tone?: ToastTone) => void;
  confirm: (request: ConfirmRequest) => Promise<boolean>;
};

const AdminFeedbackContext = createContext<AdminFeedbackValue | null>(null);

const TOAST_DURATION_MS = 6000;

/**
 * 관리자 화면 공통 피드백.
 *
 * - 토스트: 결과 안내가 페이지 최상단 배너로만 뜨면 표 하단에서 작업한 사람이
 *   성공 여부를 보지 못한다. 화면 우하단에 고정해 스크롤 위치와 무관하게 보인다.
 * - 확인창: window.confirm은 스타일을 맞출 수 없고 모바일에서 도메인이 붙어
 *   나오며 줄바꿈 처리도 브라우저마다 다르다. 같은 모달 셸로 통일한다.
 */
export default function AdminFeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const nextToastId = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = (nextToastId.current += 1);
      setToasts((current) => [...current, { id, tone, message }]);
      const timer = window.setTimeout(() => dismissToast(id), TOAST_DURATION_MS);
      timers.current.set(id, timer);
    },
    [dismissToast]
  );

  const confirm = useCallback(
    (request: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        setPendingConfirm({ ...request, resolve });
      }),
    []
  );

  const settleConfirm = useCallback(
    (confirmed: boolean) => {
      setPendingConfirm((current) => {
        current?.resolve(confirmed);
        return null;
      });
    },
    []
  );

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      for (const timer of activeTimers.values()) window.clearTimeout(timer);
      activeTimers.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast, confirm }), [confirm, toast]);

  return (
    <AdminFeedbackContext.Provider value={value}>
      {children}

      <div className={styles.toastRegion} role="status" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`${styles.toast} ${styles[item.tone]}`}>
            <span className={styles.toastIcon} aria-hidden="true">
              {item.tone === "success" ? <CheckIcon /> : <AlertIcon />}
            </span>
            <span className={styles.toastMessage}>{item.message}</span>
            <button
              type="button"
              className={styles.toastClose}
              onClick={() => dismissToast(item.id)}
              aria-label="알림 닫기"
            >
              <CloseIcon />
            </button>
          </div>
        ))}
      </div>

      {pendingConfirm && (
        <AdminDialog
          size="small"
          title={pendingConfirm.title}
          onClose={() => settleConfirm(false)}
        >
          {pendingConfirm.description && (
            <p className={styles.confirmDescription}>{pendingConfirm.description}</p>
          )}
          <AdminDialogActions
            busy={false}
            onClose={() => settleConfirm(false)}
            onSubmit={() => settleConfirm(true)}
            submitLabel={pendingConfirm.confirmLabel ?? "확인"}
            tone={pendingConfirm.tone ?? "default"}
          />
        </AdminDialog>
      )}
    </AdminFeedbackContext.Provider>
  );
}

export function useAdminFeedback() {
  const value = useContext(AdminFeedbackContext);
  if (!value) {
    throw new Error("useAdminFeedback는 AdminFeedbackProvider 안에서만 사용할 수 있습니다.");
  }
  return value;
}
