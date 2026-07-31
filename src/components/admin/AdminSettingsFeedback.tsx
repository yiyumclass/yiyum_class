"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { AlertIcon, CheckIcon } from "@/components/admin/icons";

export type SettingsFeedback = {
  tone: "success" | "error";
  message: string;
};

/**
 * 서버 액션 + redirect 구조라 결과는 쿼리로 온다. 그대로 두면 새로고침할 때마다
 * 지난 결과가 다시 뜨므로, 문구는 그대로 두고 주소창의 쿼리만 지운다.
 *
 * router.replace 대신 history.replaceState를 쓰는 이유는 화면을 다시 그리지
 * 않기 위해서다. 다시 그리면 방금 띄운 문구가 그 자리에서 사라진다.
 */
export default function AdminSettingsFeedback({
  feedback,
  className,
  errorClassName,
}: {
  feedback: SettingsFeedback | null;
  className: string;
  errorClassName: string;
}) {
  const pathname = usePathname();
  const hasFeedback = feedback !== null;

  useEffect(() => {
    if (!hasFeedback) return;
    window.history.replaceState(null, "", pathname);
  }, [hasFeedback, pathname]);

  if (!feedback) return null;

  return (
    <p
      className={feedback.tone === "error" ? errorClassName : className}
      role={feedback.tone === "error" ? "alert" : "status"}
    >
      {feedback.tone === "error" ? <AlertIcon /> : <CheckIcon />}
      {feedback.message}
    </p>
  );
}
