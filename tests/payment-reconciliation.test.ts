import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const nodeRequire = createRequire(`${repoRoot}/package.json`);
const typescript = nodeRequire("typescript") as typeof import("typescript");

type MockMap = Record<string, unknown>;
type RpcCall = { name: string; args: Record<string, unknown> | undefined };
type FromCall = { table: string; operation: string; value?: unknown };

type TossPaymentFixture = {
  paymentKey: string;
  orderId: string;
  status: string;
  totalAmount: number;
  balanceAmount: number;
  approvedAt: string | null;
  method: string | null;
  cancels: Array<{
    cancelAmount: number;
    cancelReason: string;
    canceledAt: string;
    transactionKey: string;
    cancelStatus: string;
  }>;
};

type OrderFixture = {
  id: string;
  user_id: string;
  order_uid: string;
  product_id: string;
  amount: number;
  source: "payment";
  status: "pending" | "paid" | "failed" | "canceled" | "refunded";
  payment_key: string | null;
  payment_mode: "toss_test" | "toss_live" | null;
  refund_policy_version: string | null;
  refund_policy_agreed_at: string | null;
};

const input = {
  orderId: "ORD-TEST-20261004",
  paymentKey: "pay_test_20261004",
  amount: 120000,
};

function loadTsModule(
  relativePath: string,
  mocks: MockMap,
  cache = new Map<string, { exports: Record<string, unknown> }>()
) {
  const absolutePath = resolve(repoRoot, relativePath);
  if (cache.has(absolutePath)) return cache.get(absolutePath)!.exports;

  const source = readFileSync(absolutePath, "utf8");
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
    },
  }).outputText;

  const loadedModule = { exports: {} as Record<string, unknown> };
  cache.set(absolutePath, loadedModule);
  const localRequire = (specifier: string) => {
    if (specifier in mocks) return mocks[specifier];
    if (specifier === "server-only") return {};
    if (specifier.startsWith("@/")) {
      return loadTsModule(`${specifier.replace("@/", "src/")}.ts`, mocks, cache);
    }
    if (specifier.startsWith(".")) {
      const resolvedPath = resolve(dirname(absolutePath), `${specifier}.ts`);
      if (
        resolvedPath === resolve(repoRoot, "src/lib/payments/toss.ts") &&
        "@/lib/payments/toss" in mocks
      ) {
        return mocks["@/lib/payments/toss"];
      }
      return loadTsModule(resolvedPath, mocks, cache);
    }
    return nodeRequire(specifier);
  };

  new Function("exports", "require", "module", compiled)(
    loadedModule.exports,
    localRequire,
    loadedModule
  );
  return loadedModule.exports;
}

function baseOrder(overrides: Partial<OrderFixture> = {}): OrderFixture {
  return {
    id: "order-row-id",
    user_id: "user-1",
    order_uid: input.orderId,
    product_id: "product-1",
    amount: input.amount,
    source: "payment",
    status: "pending",
    payment_key: null,
    payment_mode: "toss_test",
    refund_policy_version: "2026-10-04",
    refund_policy_agreed_at: "2026-10-04T00:00:00.000Z",
    ...overrides,
  };
}

function payment(overrides: Partial<TossPaymentFixture> = {}): TossPaymentFixture {
  return {
    paymentKey: input.paymentKey,
    orderId: input.orderId,
    status: "DONE",
    totalAmount: input.amount,
    balanceAmount: input.amount,
    approvedAt: "2026-10-04T00:00:00.000Z",
    method: "카드",
    cancels: [],
    ...overrides,
  };
}

function canceledPayment() {
  return payment({
    status: "CANCELED",
    balanceAmount: 0,
    cancels: [
      {
        cancelAmount: input.amount,
        cancelReason: "고객 요청",
        canceledAt: "2026-10-04T00:01:00.000Z",
        transactionKey: "cancel-tx-1",
        cancelStatus: "DONE",
      },
    ],
  });
}

function createAdminClient(config: {
  order?: OrderFixture | null;
  claimRows?: unknown[];
  rpc?: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: null | { code: string } }>;
}) {
  const rpcCalls: RpcCall[] = [];
  const fromCalls: FromCall[] = [];
  const admin = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (config.rpc) return config.rpc(name, args);
      if (name === "prepare_toss_confirmation_server") {
        return {
          data: [
            {
              order_uid: input.orderId,
              idempotency_key: "idem-1",
              lease_token: "lease-1",
              can_confirm: true,
            },
          ],
          error: null,
        };
      }
      if (name === "claim_toss_payment_recovery") {
        return { data: config.claimRows ?? [], error: null };
      }
      if (name === "get_toss_payment_recovery_health") {
        return {
          data: [{ pending_count: 0, review_count: 0, overdue_count: 0 }],
          error: null,
        };
      }
      return { data: true, error: null };
    },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        update: (value: unknown) => {
          fromCalls.push({ table, operation: "update", value });
          return query;
        },
        upsert: async (value: unknown) => {
          fromCalls.push({ table, operation: "upsert", value });
          return { data: null, error: null };
        },
        maybeSingle: async () => {
          fromCalls.push({ table, operation: "maybeSingle" });
          return { data: table === "orders" ? (config.order ?? null) : null, error: null };
        },
        then: (
          resolveThen: (value: { data: null; error: null }) => void,
          rejectThen: (error: unknown) => void
        ) => Promise.resolve({ data: null, error: null }).then(resolveThen, rejectThen),
      };
      return query;
    },
  };
  return { admin, rpcCalls, fromCalls };
}

function createRuntime(config: {
  order?: OrderFixture | null;
  mode?: "toss_test" | "toss_live";
  configured?: boolean;
  claimRows?: unknown[];
  rpc?: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: null | { code: string } }>;
  confirmResult?: { ok: true; payment: TossPaymentFixture } | { ok: false; code: string; message: string; retryable: boolean; httpStatus: number };
  orderLookupResult?: { ok: true; payment: TossPaymentFixture } | { ok: false; code: string; message: string; retryable: boolean; httpStatus: number };
  keyLookupResult?: { ok: true; payment: TossPaymentFixture } | { ok: false; code: string; message: string; retryable: boolean; httpStatus: number };
}) {
  const { admin, rpcCalls, fromCalls } = createAdminClient({
    order: config.order ?? baseOrder(),
    claimRows: config.claimRows,
    rpc: config.rpc,
  });
  const calls = {
    confirm: 0,
    orderLookup: 0,
    keyLookup: 0,
    cancel: 0,
  };
  const toss = {
    confirmTossPayment: async () => {
      calls.confirm += 1;
      return config.confirmResult ?? { ok: true, payment: payment() };
    },
    getTossPaymentByOrderId: async () => {
      calls.orderLookup += 1;
      return config.orderLookupResult ?? { ok: true, payment: payment() };
    },
    getTossPayment: async () => {
      calls.keyLookup += 1;
      return config.keyLookupResult ?? { ok: true, payment: payment() };
    },
    cancelTossPayment: async () => {
      calls.cancel += 1;
      return { ok: true, payment: canceledPayment() };
    },
  };
  const mocks: MockMap = {
    "next/server": { after: () => undefined },
    "next/cache": { revalidatePath: () => undefined },
    "@/lib/messaging/payment-notifications": { dispatchPaymentNotification: async () => undefined },
    "@/lib/http/origin": { isSameOriginRequest: () => true },
    "@/lib/http/request-body": {
      readLimitedJson: async (request: Request) => ({ ok: true, value: await request.json() }),
    },
    "@/lib/payments/toss": toss,
    "@/lib/store/free-enrollment": {
      getPaymentMode: () => config.mode ?? "toss_test",
      isTossPaymentConfigured: () => config.configured ?? true,
    },
    "@/lib/supabase/admin": { getAdminClient: () => admin },
    "@/lib/supabase/claims": { getVerifiedIdentity: async () => ({ userId: "user-1" }) },
    "@/lib/supabase/server": { createClient: async () => ({}) },
  };
  return { mocks, calls, rpcCalls, fromCalls };
}

async function postConfirm(runtime: ReturnType<typeof createRuntime>) {
  const route = loadTsModule("src/app/api/payments/toss/confirm/route.ts", runtime.mocks);
  const response = await (route.POST as (request: Request) => Promise<Response>)(
    new Request("https://example.test/api/payments/toss/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  );
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function postWebhook(runtime: ReturnType<typeof createRuntime>, eventStatus = "DONE") {
  const route = loadTsModule("src/app/api/payments/toss/webhook/route.ts", runtime.mocks);
  const response = await (route.POST as (request: Request) => Promise<Response>)(
    new Request("https://example.test/api/payments/toss/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "PAYMENT_STATUS_CHANGED",
        data: { orderId: input.orderId, paymentKey: input.paymentKey, status: eventStatus },
      }),
    })
  );
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function getCron(runtime: ReturnType<typeof createRuntime>) {
  const route = loadTsModule("src/app/api/cron/reconcile-payments/route.ts", runtime.mocks);
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "cron-test-secret";
  try {
    const response = await (route.GET as (request: Request) => Promise<Response>)(
      new Request("https://example.test/api/cron/reconcile-payments", {
        headers: { authorization: "Bearer cron-test-secret" },
      })
    );
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    if (previousSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = previousSecret;
    }
  }
}

test("prepare RPC failure prevents any external approval", async () => {
  const runtime = createRuntime({
    rpc: async (name) =>
      name === "prepare_toss_confirmation_server"
        ? { data: null, error: { code: "08006" } }
        : { data: true, error: null },
  });

  const result = await postConfirm(runtime);

  assert.equal(result.status, 500);
  assert.equal(result.body.ok, false);
  assert.equal(runtime.calls.confirm, 0);
  assert.equal(runtime.calls.orderLookup, 0);
});

test("stored mode mismatch does not call provider lookup or approval", async () => {
  const runtime = createRuntime({
    order: baseOrder({ payment_mode: "toss_live" }),
    mode: "toss_test",
  });

  const result = await postConfirm(runtime);

  assert.equal(result.status, 409);
  assert.equal(result.body.ok, false);
  assert.equal(runtime.calls.confirm, 0);
  assert.equal(runtime.calls.orderLookup, 0);
  assert.equal(runtime.calls.keyLookup, 0);
});

test("transient DB outage after approved provider state remains retryable, not review", async () => {
  const runtime = createRuntime({
    rpc: async (name, args) => {
      if (name === "prepare_toss_confirmation_server") {
        return {
          data: [{ order_uid: input.orderId, idempotency_key: "idem-1", lease_token: "lease-1", can_confirm: true }],
          error: null,
        };
      }
      if (name === "ensure_toss_reconciliation_server") return { data: true, error: null };
      if (name === "complete_toss_payment_server") return { data: null, error: { code: "08006" } };
      if (name === "finish_toss_payment_recovery") return { data: args, error: null };
      return { data: true, error: null };
    },
  });

  const result = await postConfirm(runtime);
  const finish = runtime.rpcCalls.find((call) => call.name === "finish_toss_payment_recovery");

  assert.equal(runtime.calls.confirm, 1);
  assert.equal(result.status, 202);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.retryable, true);
  assert.equal(finish?.args?.target_review, false);
});

test("paid order with revoked/expired grant is not returned as ok success", async () => {
  const runtime = createRuntime({
    order: baseOrder({ status: "paid", payment_key: input.paymentKey }),
    rpc: async (name) => {
      if (name === "prepare_toss_confirmation_server") {
        return {
          data: [{ order_uid: input.orderId, idempotency_key: "idem-1", lease_token: null, can_confirm: false }],
          error: null,
        };
      }
      if (name === "ensure_toss_reconciliation_server") return { data: true, error: null };
      if (name === "complete_toss_payment_server") return { data: null, error: { code: "55000" } };
      return { data: true, error: null };
    },
    orderLookupResult: { ok: true, payment: payment() },
  });

  const result = await postConfirm(runtime);

  assert.notEqual(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.equal(runtime.calls.confirm, 0);
});

test("empty payment completion RPC result is not success", async () => {
  const runtime = createRuntime({
    rpc: async (name) => {
      if (name === "prepare_toss_confirmation_server") {
        return {
          data: [{ order_uid: input.orderId, idempotency_key: "idem-1", lease_token: "lease-1", can_confirm: true }],
          error: null,
        };
      }
      if (name === "ensure_toss_reconciliation_server") return { data: true, error: null };
      if (name === "complete_toss_payment_server") return { data: [], error: null };
      return { data: true, error: null };
    },
  });

  const result = await postConfirm(runtime);

  assert.notEqual(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.retryable, false);
});

test("malformed payment completion RPC row is not success", async () => {
  const runtime = createRuntime({
    rpc: async (name) => {
      if (name === "prepare_toss_confirmation_server") {
        return {
          data: [{ order_uid: input.orderId, idempotency_key: "idem-1", lease_token: "lease-1", can_confirm: true }],
          error: null,
        };
      }
      if (name === "ensure_toss_reconciliation_server") return { data: true, error: null };
      if (name === "complete_toss_payment_server") return { data: [{}], error: null };
      return { data: true, error: null };
    },
  });

  const result = await postConfirm(runtime);

  assert.notEqual(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.retryable, false);
});

test("canonical cancellation wins over stale DONE webhook event", async () => {
  const runtime = createRuntime({
    order: baseOrder({ payment_key: input.paymentKey }),
    orderLookupResult: { ok: true, payment: canceledPayment() },
    rpc: async (name) => {
      if (name === "ensure_toss_reconciliation_server") return { data: true, error: null };
      if (name === "complete_toss_refund_server") return { data: [{ refund_status: "succeeded" }], error: null };
      if (name === "complete_toss_payment_server") {
        throw new Error("stale DONE event must not complete payment");
      }
      return { data: true, error: null };
    },
  });

  const result = await postWebhook(runtime, "DONE");

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.settled, "canceled");
  assert.ok(runtime.rpcCalls.some((call) => call.name === "complete_toss_refund_server"));
  assert.ok(!runtime.rpcCalls.some((call) => call.name === "complete_toss_payment_server"));
});

test("cron refund job seeing provider DONE does not complete payment", async () => {
  const claimRows = [
    {
      order_uid: input.orderId,
      confirmation_key: input.paymentKey,
      idempotency_key: "idem-refund-1",
      lease_token: "lease-refund-1",
      can_confirm: false,
      operation: "refund",
    },
  ];
  const runtime = createRuntime({
    claimRows,
    orderLookupResult: { ok: true, payment: payment({ status: "DONE" }) },
    rpc: async (name, args) => {
      if (name === "claim_toss_payment_recovery") return { data: claimRows, error: null };
      if (name === "get_toss_payment_recovery_health") {
        return { data: [{ pending_count: 0, review_count: 0, overdue_count: 0 }], error: null };
      }
      if (name === "finish_toss_payment_recovery") return { data: args, error: null };
      if (name === "complete_toss_payment_server") {
        throw new Error("refund recovery must not complete payment");
      }
      return { data: true, error: null };
    },
  });

  const result = await getCron(runtime);
  const finish = runtime.rpcCalls.find((call) => call.name === "finish_toss_payment_recovery");

  assert.equal(result.status, 200);
  assert.equal(runtime.calls.confirm, 0);
  assert.ok(!runtime.rpcCalls.some((call) => call.name === "complete_toss_payment_server"));
  assert.equal(finish?.args?.target_error_code, "TOSS_STATUS_DONE");
  assert.equal(finish?.args?.target_review, false);
});

function createCheckoutRuntime(config: {
  createOrderError?: { code: string };
  adminBindError?: { code: string } | null;
  adminBindData?: boolean;
}) {
  const authedRpcCalls: RpcCall[] = [];
  const adminRpcCalls: RpcCall[] = [];
  const authedClient = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      authedRpcCalls.push({ name, args });
      if (name === "create_toss_payment_order") {
        return config.createOrderError
          ? { data: null, error: config.createOrderError }
          : {
              data: [
                {
                  order_uid: input.orderId,
                  amount: input.amount,
                  order_name: "테스트 주문",
                  product_slug: "course-one",
                },
              ],
              error: null,
            };
      }
      if (name === "record_toss_refund_policy_consent") {
        return { data: true, error: null };
      }
      return { data: true, error: null };
    },
  };
  const adminClient = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      adminRpcCalls.push({ name, args });
      if (name === "bind_toss_order_mode_server") {
        return {
          data: config.adminBindData ?? true,
          error: config.adminBindError ?? null,
        };
      }
      return { data: true, error: null };
    },
  };
  const mocks: MockMap = {
    "next/cache": { revalidatePath: () => undefined },
    "next/navigation": { redirect: () => undefined },
    "@/lib/store/free-enrollment": {
      getPaymentMode: () => "toss_test",
      isTossPaymentWindowConfigured: () => true,
    },
    "@/lib/store/public-products": { loadPublicProductBySlug: async () => true },
    "@/lib/store/checkout-products": { loadCheckoutProduct: async () => true },
    "@/lib/store/membership-plans": { phonePassDefinition: { slug: "phone-pass" } },
    "@/lib/payments/refund-policy": { REFUND_POLICY_VERSION: "2026-10-04" },
    "@/lib/supabase/claims": { getVerifiedIdentity: async () => ({ userId: "user-1" }) },
    "@/lib/supabase/server": { createClient: async () => authedClient },
    "@/lib/supabase/admin": { getAdminClient: () => adminClient },
  };
  return { mocks, authedRpcCalls, adminRpcCalls };
}

test("checkout mode binding uses service-role admin client after owned order creation", async () => {
  const runtime = createCheckoutRuntime({});
  const actions = loadTsModule("src/app/checkout/actions.ts", runtime.mocks);

  const result = await (actions.createPaymentOrderAction as (
    productSlug: string,
    refundPolicyAccepted: boolean
  ) => Promise<Record<string, unknown>>)("course-one", true);

  assert.equal(result.ok, true);
  assert.ok(runtime.authedRpcCalls.some((call) => call.name === "create_toss_payment_order"));
  assert.ok(runtime.authedRpcCalls.some((call) => call.name === "record_toss_refund_policy_consent"));
  assert.ok(!runtime.authedRpcCalls.some((call) => call.name === "bind_toss_order_mode_server"));
  assert.equal(runtime.adminRpcCalls[0]?.name, "bind_toss_order_mode_server");
});

test("checkout SQL 55000 maps to do-not-repay support message", async () => {
  const runtime = createCheckoutRuntime({ createOrderError: { code: "55000" } });
  const actions = loadTsModule("src/app/checkout/actions.ts", runtime.mocks);

  const result = await (actions.createPaymentOrderAction as (
    productSlug: string,
    refundPolicyAccepted: boolean
  ) => Promise<Record<string, unknown>>)("course-one", true);

  assert.equal(result.ok, false);
  assert.equal(
    result.message,
    "이전 결제 상태를 확인 중입니다. 다시 결제하지 말고 주문번호로 문의해 주세요."
  );
  assert.ok(!runtime.adminRpcCalls.some((call) => call.name === "bind_toss_order_mode_server"));
});

function createAdminActionRuntime(config: {
  order: OrderFixture;
  mode?: "toss_test" | "toss_live";
  keyLookupResult?: { ok: true; payment: TossPaymentFixture } | { ok: false; code: string; message: string; retryable: boolean; httpStatus: number };
  refundRows?: unknown[];
}) {
  const runtime = createRuntime({
    order: config.order,
    mode: config.mode ?? "toss_test",
    keyLookupResult: config.keyLookupResult,
    rpc: async (name, args) => {
      if (name === "bind_toss_order_mode_server") return { data: true, error: null };
      if (name === "begin_toss_refund_server") {
        return {
          data: [
            {
              refund_id: "refund-row-id",
              refund_uid: "RFD-test",
              order_uid: input.orderId,
              payment_key: input.paymentKey,
              amount: input.amount,
              idempotency_key: "refund-idem-1",
            },
          ],
          error: null,
        };
      }
      if (name === "ensure_toss_reconciliation_server") return { data: true, error: null };
      if (name === "complete_toss_refund_server") {
        return { data: config.refundRows ?? [{ refund_status: "succeeded" }], error: null };
      }
      if (name === "finish_toss_payment_recovery") return { data: args, error: null };
      return { data: true, error: null };
    },
  });
  runtime.mocks["@/lib/admin/auth"] = {
    requireAdmin: async () => ({ userId: "owner-1" }),
    requireOwnerAdmin: async () => ({ userId: "owner-1" }),
  };
  runtime.mocks["@/lib/admin/list-params"] = {
    readOption: (_value: unknown, _options: unknown, fallback: unknown) => fallback,
    readParam: (value: unknown) => value,
    resolvePeriodStart: () => null,
  };
  runtime.mocks["@/lib/admin/orders"] = {
    ADMIN_ORDER_PERIODS: [],
    ADMIN_ORDER_PRODUCT_TYPE_FILTERS: [],
    ADMIN_ORDER_SORTS: [],
    ADMIN_ORDER_SOURCE_FILTERS: [],
    ADMIN_ORDER_STATUS_FILTERS: [],
    loadAdminOrdersForExport: async () => ({ orders: [], truncated: false }),
  };
  runtime.mocks["@/lib/store/free-enrollment"] = {
    getPaymentMode: () => config.mode ?? "toss_test",
    isTossPaymentConfigured: () => true,
  };
  runtime.mocks["@/lib/validation/safe-input"] = { isUuid: () => true };
  return runtime;
}

test("legacy null-mode refund verifies provider, binds mode, then begins durable refund", async () => {
  const runtime = createAdminActionRuntime({
    order: baseOrder({
      id: "11111111-1111-4111-8111-111111111111",
      status: "paid",
      payment_key: input.paymentKey,
      payment_mode: null,
    }),
    keyLookupResult: { ok: true, payment: payment() },
  });
  const actions = loadTsModule("src/app/admin/orders/actions.ts", runtime.mocks);

  const result = await (actions.refundPaymentOrderAction as (
    orderId: string,
    reason: string
  ) => Promise<Record<string, unknown>>)("11111111-1111-4111-8111-111111111111", "고객 요청");
  const bindIndex = runtime.rpcCalls.findIndex((call) => call.name === "bind_toss_order_mode_server");
  const beginIndex = runtime.rpcCalls.findIndex((call) => call.name === "begin_toss_refund_server");

  assert.equal(result.ok, true);
  assert.equal(runtime.calls.keyLookup, 1);
  assert.equal(runtime.calls.cancel, 1);
  assert.ok(bindIndex >= 0);
  assert.ok(beginIndex > bindIndex);
});

test("refund mode mismatch rejects before provider lookup or begin", async () => {
  const runtime = createAdminActionRuntime({
    order: baseOrder({
      id: "22222222-2222-4222-8222-222222222222",
      status: "paid",
      payment_key: input.paymentKey,
      payment_mode: "toss_live",
    }),
    mode: "toss_test",
  });
  const actions = loadTsModule("src/app/admin/orders/actions.ts", runtime.mocks);

  const result = await (actions.refundPaymentOrderAction as (
    orderId: string,
    reason: string
  ) => Promise<Record<string, unknown>>)("22222222-2222-4222-8222-222222222222", "고객 요청");

  assert.equal(result.ok, false);
  assert.equal(runtime.calls.keyLookup, 0);
  assert.equal(runtime.calls.orderLookup, 0);
  assert.equal(runtime.calls.cancel, 0);
  assert.ok(!runtime.rpcCalls.some((call) => call.name === "begin_toss_refund_server"));
});

test("legacy canceled refund review reports admin-review message without new cancel", async () => {
  const runtime = createAdminActionRuntime({
    order: baseOrder({
      id: "33333333-3333-4333-8333-333333333333",
      status: "paid",
      payment_key: input.paymentKey,
      payment_mode: null,
    }),
    keyLookupResult: { ok: true, payment: canceledPayment() },
    refundRows: [{ refund_status: "review" }],
  });
  const actions = loadTsModule("src/app/admin/orders/actions.ts", runtime.mocks);

  const result = await (actions.refundPaymentOrderAction as (
    orderId: string,
    reason: string
  ) => Promise<Record<string, unknown>>)("33333333-3333-4333-8333-333333333333", "고객 요청");

  assert.equal(result.ok, false);
  assert.equal(
    result.message,
    "Toss 환불은 완료됐지만 이전 수강권 연결은 관리자 검토가 필요합니다."
  );
  assert.equal(runtime.calls.cancel, 0);
  assert.ok(!runtime.rpcCalls.some((call) => call.name === "begin_toss_refund_server"));
});

test("Toss confirm sends stable idempotency in header, not JSON body", async () => {
  const previousSecret = process.env.TOSS_SECRET_KEY;
  const previousFetch = globalThis.fetch;
  let capturedInit: RequestInit | undefined;
  process.env.TOSS_SECRET_KEY = "test-secret";
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedInit = init;
    return new Response(JSON.stringify(payment()), { status: 200 });
  }) as typeof fetch;

  try {
    const toss = loadTsModule("src/lib/payments/toss.ts", {});
    const result = await (toss.confirmTossPayment as (value: {
      paymentKey: string;
      orderId: string;
      amount: number;
      idempotencyKey: string;
    }) => Promise<Record<string, unknown>>)({
      paymentKey: input.paymentKey,
      orderId: input.orderId,
      amount: input.amount,
      idempotencyKey: "idem-header-1",
    });
    const headers = capturedInit?.headers as Record<string, string>;
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;

    assert.equal(result.ok, true);
    assert.equal(headers["Idempotency-Key"], "idem-header-1");
    assert.equal(body.idempotencyKey, undefined);
    assert.equal(body.paymentKey, input.paymentKey);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSecret === undefined) {
      delete process.env.TOSS_SECRET_KEY;
    } else {
      process.env.TOSS_SECRET_KEY = previousSecret;
    }
  }
});
