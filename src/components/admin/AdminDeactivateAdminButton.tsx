"use client";

import { useRef } from "react";
import { useAdminFeedback } from "@/components/admin/AdminFeedback";
import { deactivateAdminUserAction } from "@/app/admin/settings/actions";

// 운영자 비활성화는 즉시 관리자 접근을 끊는 되돌리기 어려운 조작이다.
// 확인은 관리자 화면 공통 확인창(tone="danger")으로 통일한다.
export default function AdminDeactivateAdminButton({
  userId,
  label,
  disabled,
  blockedReason,
  className,
}: {
  userId: string;
  label: string;
  disabled: boolean;
  /** 규칙상 막힌 경우의 사유. 사후 에러 대신 버튼 위에서 미리 알린다. */
  blockedReason?: string | null;
  className?: string;
}) {
  const { confirm } = useAdminFeedback();
  const formRef = useRef<HTMLFormElement>(null);

  const handleClick = async () => {
    const ok = await confirm({
      title: `${label} 님의 관리자 권한을 해제할까요?`,
      description:
        "해제하면 관리자 화면 접근이 즉시 끊깁니다.\n다시 부여하려면 운영자 추가에서 같은 회원을 지정해야 합니다.",
      confirmLabel: "권한 해제",
      tone: "danger",
    });
    if (!ok) return;
    formRef.current?.requestSubmit();
  };

  return (
    <form action={deactivateAdminUserAction} ref={formRef}>
      <input type="hidden" name="userId" value={userId} />
      <button
        type="button"
        className={className}
        disabled={disabled}
        title={blockedReason ?? undefined}
        onClick={handleClick}
      >
        비활성화
      </button>
    </form>
  );
}
