import "server-only";

const TOSS_API_BASE_URL = "https://api.tosspayments.com/v1";

export type TossPayment = {
  paymentKey: string;
  orderId: string;
  status: string;
  totalAmount: number;
  balanceAmount: number;
  approvedAt: string | null;
  method: string | null;
  cancels: TossCancellation[];
};

export type TossCancellation = {
  cancelAmount: number;
  cancelReason: string;
  canceledAt: string;
  transactionKey: string;
  cancelStatus: string;
};

export type TossApiResult =
  | { ok: true; payment: TossPayment }
  | {
      ok: false;
      httpStatus: number;
      code: string;
      message: string;
      retryable: boolean;
    };

export async function confirmTossPayment(input: {
  paymentKey: string;
  orderId: string;
  amount: number;
}): Promise<TossApiResult> {
  return requestTossPayment("/payments/confirm", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getTossPayment(paymentKey: string): Promise<TossApiResult> {
  return requestTossPayment(`/payments/${encodeURIComponent(paymentKey)}`, {
    method: "GET",
  });
}

export async function cancelTossPayment(input: {
  paymentKey: string;
  cancelReason: string;
  idempotencyKey: string;
}): Promise<TossApiResult> {
  return requestTossPayment(`/payments/${encodeURIComponent(input.paymentKey)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ cancelReason: input.cancelReason }),
    headers: { "Idempotency-Key": input.idempotencyKey },
  });
}

async function requestTossPayment(
  path: string,
  init: Pick<RequestInit, "method" | "body"> & { headers?: Record<string, string> }
): Promise<TossApiResult> {
  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) {
    return {
      ok: false,
      httpStatus: 503,
      code: "TOSS_SECRET_NOT_CONFIGURED",
      message: "Toss Payments 시크릿 키가 설정되지 않았습니다.",
      retryable: false,
    };
  }
  let response: Response;

  try {
    response = await fetch(`${TOSS_API_BASE_URL}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch {
    return {
      ok: false,
      httpStatus: 503,
      code: "TOSS_API_UNAVAILABLE",
      message: "Toss Payments API에 연결하지 못했습니다.",
      retryable: true,
    };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = readTossError(payload);
    return {
      ok: false,
      httpStatus: response.status,
      code: error.code,
      message: error.message,
      retryable: response.status >= 500,
    };
  }

  const payment = readTossPayment(payload);
  if (!payment) {
    return {
      ok: false,
      httpStatus: 502,
      code: "INVALID_TOSS_RESPONSE",
      message: "Toss Payments 응답을 확인하지 못했습니다.",
      retryable: true,
    };
  }

  return { ok: true, payment };
}

function readTossPayment(payload: unknown): TossPayment | null {
  if (!isRecord(payload)) return null;
  if (
    typeof payload.paymentKey !== "string" ||
    typeof payload.orderId !== "string" ||
    typeof payload.status !== "string" ||
    typeof payload.totalAmount !== "number" ||
    typeof payload.balanceAmount !== "number"
  ) {
    return null;
  }

  const cancels = Array.isArray(payload.cancels)
    ? payload.cancels.map(readTossCancellation).filter((item) => item !== null)
    : [];

  return {
    paymentKey: payload.paymentKey,
    orderId: payload.orderId,
    status: payload.status,
    totalAmount: payload.totalAmount,
    balanceAmount: payload.balanceAmount,
    approvedAt: typeof payload.approvedAt === "string" ? payload.approvedAt : null,
    method: typeof payload.method === "string" ? payload.method : null,
    cancels,
  };
}

function readTossCancellation(payload: unknown): TossCancellation | null {
  if (!isRecord(payload)) return null;
  if (
    typeof payload.cancelAmount !== "number" ||
    typeof payload.cancelReason !== "string" ||
    typeof payload.canceledAt !== "string" ||
    typeof payload.transactionKey !== "string" ||
    typeof payload.cancelStatus !== "string"
  ) {
    return null;
  }

  return {
    cancelAmount: payload.cancelAmount,
    cancelReason: payload.cancelReason,
    canceledAt: payload.canceledAt,
    transactionKey: payload.transactionKey,
    cancelStatus: payload.cancelStatus,
  };
}

function readTossError(payload: unknown) {
  if (!isRecord(payload)) {
    return { code: "UNKNOWN_TOSS_ERROR", message: "결제 승인 요청이 실패했습니다." };
  }
  return {
    code: typeof payload.code === "string" ? payload.code : "UNKNOWN_TOSS_ERROR",
    message:
      typeof payload.message === "string"
        ? payload.message
        : "결제 승인 요청이 실패했습니다.",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
