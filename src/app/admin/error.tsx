"use client";

import Link from "next/link";
import { useEffect } from "react";

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
    <div
      role="alert"
      style={{
        margin: "48px auto",
        maxWidth: 520,
        padding: "28px 26px",
        border: "1px solid #d7cfc1",
        borderRadius: 12,
        background: "#fffaf3",
        color: "#2b2119",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.12em",
          color: "#9a8e80",
        }}
      >
        ADMIN ERROR
      </span>
      <h1 style={{ margin: "8px 0 10px", fontSize: 19, fontWeight: 700 }}>
        관리자 화면을 불러오지 못했습니다
      </h1>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#5f564c" }}>
        일시적인 오류일 수 있습니다. 다시 시도해도 같은 화면이 나오면 데이터베이스
        마이그레이션 적용 상태를 확인해 주세요.
      </p>
      {error.digest && (
        <p style={{ margin: "12px 0 0", fontSize: 12, color: "#9a8e80" }}>
          오류 코드 {error.digest}
        </p>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            minHeight: 38,
            padding: "0 16px",
            border: "1px solid #2b2119",
            borderRadius: 8,
            background: "#2b2119",
            color: "#fffaf3",
            font: "inherit",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          다시 시도
        </button>
        <Link
          href="/admin"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 38,
            padding: "0 16px",
            border: "1px solid #d7cfc1",
            borderRadius: 8,
            color: "#2b2119",
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          관리자 홈
        </Link>
      </div>
    </div>
  );
}
