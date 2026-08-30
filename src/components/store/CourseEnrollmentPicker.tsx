"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { membershipPlanDefinitions } from "@/lib/store/membership-plans";
import {
  calculateMonthlyInstallmentKrw,
  formatKrw,
} from "@/lib/store/pricing";
import styles from "./CourseEnrollmentPicker.module.css";

const installmentMonths = 12;

export type MembershipProductOption = {
  slug: string;
  priceKrw: number;
  soldOut: boolean;
  checkoutHref: string;
};

type CourseEnrollmentProviderProps = {
  products: MembershipProductOption[];
  complianceNotice?: string;
  children: ReactNode;
};

type CourseEnrollmentPickerProps = {
  triggerLabel?: string;
  triggerClassName?: string;
  triggerVariant?: "default" | "compact";
};

type EnrollmentDialogController = {
  open: boolean;
  show: (trigger: HTMLButtonElement) => void;
};

const EnrollmentDialogContext = createContext<EnrollmentDialogController | null>(null);

export function CourseEnrollmentProvider({
  products,
  complianceNotice,
  children,
}: CourseEnrollmentProviderProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const productBySlug = useMemo(
    () => new Map(products.map((product) => [product.slug, product])),
    [products]
  );
  const show = useCallback((trigger: HTMLButtonElement) => {
    returnFocusRef.current = trigger;
    setOpen(true);
  }, []);
  const controller = useMemo(() => ({ open, show }), [open, show]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const trigger = returnFocusRef.current;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleEscape);

    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleEscape);
      trigger?.focus();
    };
  }, [open]);

  const keepFocusInside = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const dialog = open ? (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={keepFocusInside}
      >
        <header className={styles.dialogHeader}>
          <div>
            <span className={styles.eyebrow}>ENROLLMENT OPTIONS</span>
            <h2 id={titleId} className="serif">
              수강 방식을 선택해 주세요
            </h2>
            <p id={descriptionId}>
              강의 내용은 같고, 함께 제공되는 피드백과 코칭 범위가 달라요.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className={styles.closeButton}
            aria-label="수강 방식 선택창 닫기"
            onClick={() => setOpen(false)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className={styles.planGrid}>
          {membershipPlanDefinitions.map((plan) => {
            const product = productBySlug.get(plan.slug);
            const priceKrw = product?.priceKrw ?? plan.fallbackPriceKrw;
            const monthlyKrw = calculateMonthlyInstallmentKrw(
              priceKrw,
              installmentMonths
            );
            const monthlyIsEstimate = priceKrw % installmentMonths !== 0;
            const unavailable = !product || product.soldOut;

            return (
              <article
                key={plan.slug}
                className={`${styles.planCard} ${
                  plan.recommended ? styles.recommendedCard : ""
                }`}
              >
                {plan.recommended && (
                  <span className={styles.recommendation}>가장 많이 선택해요</span>
                )}
                <span className={styles.planEyebrow}>{plan.eyebrow}</span>
                <h3 className="serif">{plan.title}</h3>
                <p className={styles.planDescription}>{plan.description}</p>

                <div className={styles.priceBlock}>
                  <div className={styles.monthlyPrice}>
                    <span>월</span>
                    <strong className="serif">
                      {monthlyIsEstimate && <em>약</em>}
                      {formatKrw(monthlyKrw)}
                      <small>원</small>
                    </strong>
                  </div>
                  <p className={styles.installmentGuide}>
                    {installmentMonths}개월 할부 기준
                  </p>
                  <div className={styles.totalPrice}>
                    <span>총 결제금액</span>
                    <strong>{formatKrw(priceKrw)}원</strong>
                  </div>
                </div>

                <ul aria-label={`${plan.title} 포함 혜택`}>
                  {plan.benefits.map((benefit) => (
                    <li key={benefit}>
                      <span aria-hidden="true">✓</span>
                      {benefit}
                    </li>
                  ))}
                </ul>

                {unavailable ? (
                  <span className={styles.disabledAction} aria-disabled="true">
                    {product?.soldOut ? "지금은 신청 마감" : "판매 준비 중"}
                  </span>
                ) : (
                  <Link href={product.checkoutHref} className={styles.selectAction}>
                    {plan.title} 선택 <span aria-hidden="true">→</span>
                  </Link>
                )}
              </article>
            );
          })}
        </div>

        <footer className={styles.dialogFooter}>
          <p>
            월 금액은 부가세 포함 총 결제금액을 12개월로 나눈 예상액입니다. 실제
            할부 가능 여부와 무이자 적용 조건은 카드사별로 다르며 토스 결제창에서
            확인할 수 있어요.
          </p>
          {complianceNotice && <p className={styles.compliance}>{complianceNotice}</p>}
        </footer>
      </section>
    </div>
  ) : null;

  return (
    <EnrollmentDialogContext.Provider value={controller}>
      {children}
      {typeof document !== "undefined" && dialog ? createPortal(dialog, document.body) : null}
    </EnrollmentDialogContext.Provider>
  );
}

export default function CourseEnrollmentPicker({
  triggerLabel = "수강 신청",
  triggerClassName,
  triggerVariant = "default",
}: CourseEnrollmentPickerProps) {
  const controller = useContext(EnrollmentDialogContext);
  if (!controller) {
    throw new Error("CourseEnrollmentPicker must be used inside CourseEnrollmentProvider.");
  }

  return (
    <button
      type="button"
      className={`${styles.triggerButton} ${
        triggerVariant === "compact" ? styles.compactTrigger : ""
      } ${triggerClassName ?? ""}`}
      aria-haspopup="dialog"
      aria-expanded={controller.open}
      onClick={(event) => {
        controller.show(event.currentTarget);
      }}
    >
      {triggerLabel} <span aria-hidden="true">→</span>
    </button>
  );
}
