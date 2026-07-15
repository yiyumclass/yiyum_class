"use client";

import { useActionState, useMemo } from "react";
import {
  claimFreeProductAction,
  type FreeEnrollmentState,
} from "@/app/checkout/actions";

const initialState: FreeEnrollmentState = {
  status: "idle",
  message: "",
};

export default function FreeEnrollmentForm({ productSlug }: { productSlug: string }) {
  const action = useMemo(
    () => claimFreeProductAction.bind(null, productSlug),
    [productSlug]
  );
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        style={{
          width: "100%",
          height: 54,
          borderRadius: 100,
          border: "none",
          background: "#D9825E",
          color: "#1B1815",
          fontSize: 16,
          fontWeight: 700,
          cursor: pending ? "wait" : "pointer",
          opacity: pending ? 0.7 : 1,
        }}
      >
        {pending ? "신청 처리 중..." : "무료로 바로 신청하기"}
      </button>
      {state.status === "error" && (
        <p
          role="alert"
          style={{ color: "#F0A98C", fontSize: 13, lineHeight: 1.6, margin: "14px 0 0" }}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
