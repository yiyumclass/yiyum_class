import Link from "next/link";
import CourseRefundPolicy from "@/components/legal/CourseRefundPolicy";
import styles from "./CoursePurchasePolicy.module.css";

type CoursePurchasePolicyProps = {
  embedded?: boolean;
};

export default function CoursePurchasePolicy({ embedded = false }: CoursePurchasePolicyProps) {
  return (
    <div
      id="purchase-policy"
      className={`${styles.policy} ${embedded ? styles.embedded : styles.standalone}`}
      role="region"
      aria-label="교환·환불 안내"
    >
      <details className={styles.details}>
        <summary className={styles.summary}>
          <span className={styles.summaryText}>
            <span className={styles.title}>교환·환불 안내</span>
            <span className={styles.overview}>
              <span>결제 후 7일 이내,</span>{" "}
              <span>유료 강의·자료 미이용 시 전액 환불</span>
            </span>
          </span>
          <span className={styles.icon} aria-hidden="true">+</span>
        </summary>
        <div className={styles.body}>
          <CourseRefundPolicy />
          <div className={styles.contact}>
            <span>교환·콘텐츠 재제공 문의</span>
            <a href="mailto:yiyum.home@gmail.com">yiyum.home@gmail.com</a>
          </div>
          <Link className={styles.termsLink} href="/terms#refund-policy">이용약관 전체 보기 →</Link>
        </div>
      </details>
    </div>
  );
}
