"use client";

import { useState } from "react";
import { deactivateAdminUserAction } from "@/app/admin/settings/actions";

// 운영자 비활성화는 즉시 관리자 접근을 끊는 되돌리기 어려운 조작이다.
// 영상 삭제(AdminLessonVideoDialog)와 같은 2단계 인라인 확인 방식을 따른다.
export default function AdminDeactivateAdminButton({
  userId,
  label,
  disabled,
  className,
  confirmClassName,
}: {
  userId: string;
  label: string;
  disabled: boolean;
  className?: string;
  confirmClassName?: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={() => setConfirming(true)}
      >
        비활성화
      </button>
    );
  }

  return (
    <div className={confirmClassName} role="alert">
      <p>{label} 님의 관리자 권한을 즉시 해제할까요?</p>
      <span>
        <button type="button" onClick={() => setConfirming(false)}>
          취소
        </button>
        <form action={deactivateAdminUserAction}>
          <input type="hidden" name="userId" value={userId} />
          <button type="submit">비활성화 확인</button>
        </form>
      </span>
    </div>
  );
}
