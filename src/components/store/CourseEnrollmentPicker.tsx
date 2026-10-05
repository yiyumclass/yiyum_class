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
import { getSaleAvailability, getSaleAvailabilitySummary } from "@/lib/store/sale-availability";
import {
  calculateMonthlyInstallmentKrw,
  formatKrw,
} from "@/lib/store/pricing";
import styles from "./CourseEnrollmentPicker.module.css";

const installmentMonths = 12;

export type MembershipProductOption = {
  slug: string;
  title: string;
  priceKrw: number;
  soldOut: boolean;
  status?: string;
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
  const tierStatuses = membershipPlanDefinitions.map((plan) => {
    const product = productBySlug.get(plan.slug);
    return product?.status ?? (product ? (product.soldOut ? "sold_out" : "active") : undefined);
  });
  const saleSummary = getSaleAvailabilitySummary(tierStatuses);
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
            <span className={styles.eyebrow}>YIYUM SNS CLASS</span>
            <h2 id={titleId} className="serif">
              이윰 SNS 수익화 클래스 둘러보기
            </h2>
            <p id={descriptionId}>
              클래스별 학습 방식과 제공 혜택을 비교해 보세요.
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

        {saleSummary !== "available" && (
          <p className={styles.availabilityNotice} role="status">
            {saleSummary === "all_sold_out" ? "현재 모든 등급이 품절입니다. 가격과 혜택은 아래에서 비교할 수 있어요." :
              saleSummary === "unavailable" ? "현재 신청 가능한 등급이 없습니다. 판매 준비 상태를 확인해 주세요." :
              "품절 또는 준비 중인 등급을 제외하고 판매 중인 등급을 선택할 수 있어요."}
          </p>
        )}
        <div className={styles.planGrid}>
          {membershipPlanDefinitions.map((plan, index) => {
            const product = productBySlug.get(plan.slug);
            const title = product?.title ?? plan.title;
            const priceKrw = product?.priceKrw ?? plan.fallbackPriceKrw;
            const monthlyKrw = calculateMonthlyInstallmentKrw(
              priceKrw,
              installmentMonths
            );
            const monthlyIsEstimate = priceKrw % installmentMonths !== 0;
            const availability = getSaleAvailability(tierStatuses[index]);

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
                <h3
                  className={`${styles.planTitle} serif`}
                  aria-label={`${plan.order}번 ${plan.icon} ${title}`}
                >
                  <span className={styles.planTitleNumber} aria-hidden="true">
                    {plan.order}
                  </span>
                  <span className={styles.planTitleIcon} aria-hidden="true">
                    {plan.icon}
                  </span>
                  <span className={styles.planTitleText} aria-hidden="true">
                    {title}
                  </span>
                </h3>
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

                <ul aria-label={`${plan.icon} ${title} 포함 혜택`}>
                  {plan.benefits.map((benefit) => (
                    <li key={benefit}>
                      <span aria-hidden="true">✓</span>
                      {benefit}
                    </li>
                  ))}
                </ul>

                {!product || !availability.canPurchase ? (
                  <button type="button" className={styles.disabledAction} disabled>
                    {availability.label}
                  </button>
                ) : (
                  <Link href={product.checkoutHref} className={styles.selectAction}>
                    {plan.icon} {title} 선택 <span aria-hidden="true">→</span>
                  </Link>
                )}
              </article>
            );
          })}
        </div>

        <footer className={styles.dialogFooter}>
          <p><Link href="/terms#refund-policy">교환·환불 규정 확인</Link></p>
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
