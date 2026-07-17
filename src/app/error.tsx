"use client";

import Link from "next/link";
import { useEffect } from "react";
import styles from "./error-states.module.css";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 프로덕션 관측용 로깅 (사용자에게는 스택 등 민감정보를 노출하지 않는다)
    console.error(error);
  }, [error]);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Link href="/" className={`serif ${styles.brand}`}>
          이윰
        </Link>
        <span className={styles.status}>ERROR</span>
        <h1>일시적인 오류가 발생했어요</h1>
        <p>
          잠시 후 다시 시도해 주세요.
          <br />
          문제가 계속되면 카카오톡 채널로 알려 주세요.
        </p>
        {error.digest && (
          <span className={styles.digest}>오류 코드 {error.digest}</span>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            onClick={() => reset()}
            className={styles.primaryAction}
          >
            다시 시도
          </button>
          <Link href="/" className={styles.secondaryAction}>
            홈으로 돌아가기
          </Link>
        </div>
      </div>
    </main>
  );
}
