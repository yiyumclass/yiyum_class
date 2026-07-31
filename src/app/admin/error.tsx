"use client";

import Link from "next/link";
import { useEffect } from "react";
import styles from "./admin.module.css";

// 관리자 화면은 루트 error.tsx(일반 사용자용 안내)로 떨어지면 맥락을 잃는다.
// 운영자에게 필요한 것은 홈으로 가는 링크가 아니라 재시도와 오류 코드다.
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin route error:", error);
  }, [error]);

  return (
    <div role="alert" className={styles.errorPanel}>
      <p className={styles.errorKicker}>ADMIN ERROR</p>
      <h1>관리자 화면을 불러오지 못했습니다</h1>
      <p>
        일시적인 오류일 수 있습니다. 다시 시도해도 같은 화면이 나오면 데이터베이스
        마이그레이션 적용 상태를 확인해 주세요.
      </p>
      {error.digest && <p className={styles.errorDigest}>오류 코드 {error.digest}</p>}
      <div className={styles.errorActions}>
        <button type="button" className={styles.errorRetry} onClick={() => reset()}>
          다시 시도
        </button>
        <Link href="/admin" className={styles.errorHomeLink}>
          관리자 홈
        </Link>
      </div>
    </div>
  );
}
