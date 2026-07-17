"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "32px 20px",
          background: "#f3efe8",
          color: "#201c17",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <div
          style={{
            width: "min(100%, 480px)",
            padding: "44px 42px",
            border: "1px solid #ded6ca",
            borderRadius: 13,
            background: "#fbf8f2",
            textAlign: "center",
            boxShadow: "0 18px 42px rgba(58, 49, 39, 0.07)",
          }}
        >
          <span
            style={{
              display: "block",
              marginBottom: 10,
              color: "#b85c38",
              fontSize: 10,
              fontWeight: 750,
              letterSpacing: "0.16em",
            }}
          >
            ERROR
          </span>
          <h1
            style={{
              margin: 0,
              fontSize: 24,
              letterSpacing: "-0.035em",
            }}
          >
            문제가 발생했어요
          </h1>
          <p
            style={{
              margin: "15px 0 28px",
              color: "#81786d",
              fontSize: 13,
              lineHeight: 1.75,
            }}
          >
            페이지를 불러오는 중 오류가 발생했어요.
            <br />
            잠시 후 다시 시도해 주세요.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              minWidth: 180,
              minHeight: 44,
              padding: "0 24px",
              borderRadius: 8,
              border: "none",
              background: "#2a251f",
              color: "#f9f4ec",
              fontSize: 12,
              fontWeight: 650,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
