"use client";

import { useEffect, useRef } from "react";
import { markPaymentOrderFailedAction } from "@/app/checkout/actions";

export default function TossPaymentFailure({ orderId }: { orderId: string }) {
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !orderId) return;
    started.current = true;
    void markPaymentOrderFailedAction(orderId);
  }, [orderId]);

  return null;
}
