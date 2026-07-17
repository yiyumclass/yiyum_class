import type { Metadata } from "next";
import Link from "next/link";
import styles from "./error-states.module.css";

export const metadata: Metadata = {
  title: "페이지를 찾을 수 없어요 | 이윰 클래스",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Link href="/" className={`serif ${styles.brand}`}>
          이윰
        </Link>
        <span className={styles.status}>404 NOT FOUND</span>
        <h1>페이지를 찾을 수 없어요</h1>
        <p>
          주소가 바뀌었거나 삭제된 페이지일 수 있어요.
          <br />
          아래에서 원하는 곳으로 이동해 주세요.
        </p>
        <div className={styles.actions}>
          <Link href="/" className={styles.primaryAction}>
            홈으로 돌아가기
          </Link>
          <Link href="/courses" className={styles.secondaryAction}>
            강의 보러가기
          </Link>
        </div>
      </div>
    </main>
  );
}
