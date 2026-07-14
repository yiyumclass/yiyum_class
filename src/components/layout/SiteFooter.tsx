import Link from "next/link";
import styles from "./SiteFooter.module.css";

type SiteFooterProps = {
  variant?: "full" | "compact";
  tone?: "light" | "dark";
};

export default function SiteFooter({
  variant = "full",
  tone = "light",
}: SiteFooterProps) {
  return (
    <footer
      className={`${styles.footer} ${variant === "compact" ? styles.compact : ""} ${tone === "dark" ? styles.dark : ""}`}
    >
      <div className={styles.inner}>
        {variant === "full" ? (
          <div className={styles.businessBlock}>
            <Link href="/" className={`serif ${styles.brand}`} aria-label="이윰 홈">
              이윰 SNS 수익화 클래스
            </Link>
            <address className={styles.businessInfo}>
              <span>히너스랩 · 대표 지예솔 · 사업자등록번호 866-03-03562</span>
              <span>
                경기도 화성시 효행로 1068, 603-J65호(병점동, 리더스프라자)
                <span aria-hidden="true"> · </span>
                <a href="tel:07079549050">070-7954-9050</a>
                <span aria-hidden="true"> · </span>
                <a href="mailto:yiyum.home@gmail.com">yiyum.home@gmail.com</a>
              </span>
              <span>업무시간 평일 10:00–17:00 (점심 12–13시), 주말·공휴일 제외</span>
            </address>
          </div>
        ) : (
          <div className={styles.compactIdentity}>
            <Link href="/" className={`serif ${styles.brand}`} aria-label="이윰 홈">
              이윰
            </Link>
            <span>히너스랩 · 대표 지예솔 · 사업자등록번호 866-03-03562</span>
          </div>
        )}

        <nav className={styles.links} aria-label="푸터 메뉴">
          <Link href="/contact">문의하기</Link>
          <Link href="/privacy" className={styles.privacyLink}>
            개인정보처리방침
          </Link>
          <Link href="/terms">이용약관</Link>
        </nav>
      </div>
    </footer>
  );
}
