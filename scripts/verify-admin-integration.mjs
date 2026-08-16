import { readFile } from "node:fs/promises";

const env = await loadEnv(".env.local");
const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const paymentMode = env.PAYMENT_MODE || "free";

if (!baseUrl || !anonKey) {
  throw new Error(".env.local의 Supabase URL과 anon key가 필요합니다.");
}

const headers = {
  apikey: anonKey,
  Authorization: `Bearer ${anonKey}`,
  "Content-Type": "application/json",
};

const outlineResponse = await fetch(`${baseUrl}/rest/v1/rpc/get_public_course_catalog_outline`, {
  method: "POST",
  headers,
  body: "{}",
});
const outlineBody = await readJson(outlineResponse);
assert(
  outlineResponse.ok && Array.isArray(outlineBody),
  `공개 커리큘럼 RPC 점검 실패: HTTP ${outlineResponse.status} ${formatError(outlineBody)}`
);

const productsResponse = await fetch(`${baseUrl}/rest/v1/rpc/get_public_products`, {
  method: "POST",
  headers,
  body: JSON.stringify({ target_slug: null }),
});
const products = await readJson(productsResponse);
assert(productsResponse.ok && Array.isArray(products), "판매 상품 조회에 실패했습니다.");
assert(products.length > 0, "판매 중인 테스트 상품이 없습니다.");

await assertFunctionDenied("get_admin_order_ledger_summary", {
  p_search: null,
  p_product_type: "all",
  p_source: "all",
  p_status: "all",
  p_since: null,
  p_attention: false,
});
console.log("✓ 익명 사용자의 관리자 RPC 실행 차단");

if (paymentMode === "free") {
  assert(
    products.every((product) => product.price_krw === 0),
    "무료 신청 모드인데 0원이 아닌 판매 중 상품이 있습니다."
  );
  await assertFunctionExists("claim_free_product", { target_product_slug: "__integration-smoke-check__" });
  console.log(`✓ 판매 중 무료 상품: ${products.length}개`);
  console.log("✓ 무료 신청 RPC: 배포 확인");
} else {
  assert(
    paymentMode === "toss_test" || paymentMode === "toss_live",
    `지원하지 않는 PAYMENT_MODE입니다: ${paymentMode}`
  );
  assert(env.NEXT_PUBLIC_TOSS_CLIENT_KEY && env.TOSS_SECRET_KEY, "Toss 결제 키가 필요합니다.");
  assert(
    products.some((product) => product.price_krw > 0),
    "Toss 결제 모드인데 0원 초과 판매 상품이 없습니다."
  );
  await assertFunctionExists("create_toss_payment_order", {
    target_product_slug: "__integration-smoke-check__",
  });
  await assertFunctionExists("record_toss_refund_policy_consent", {
    target_order_uid: "__integration-smoke-check__",
    target_policy_version: "2026-07-29",
  });
  await assertFunctionExists("get_my_order_ledger", {});
  console.log(`✓ 판매 중 Toss 상품: ${products.filter((product) => product.price_krw > 0).length}개`);
  console.log("✓ Toss 주문/동의/회원 원장 RPC: 배포 확인");
}

console.log(`✓ 공개 커리큘럼 RPC: ${outlineBody.length}행`);
console.log(`✓ 결제 모드: ${paymentMode}`);

async function assertFunctionExists(name, body) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = await readJson(response);
  assert(payload?.code !== "PGRST202", `${name} RPC가 배포되지 않았습니다.`);
}

async function assertFunctionDenied(name, body) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = await readJson(response);
  assert(
    [401, 403].includes(response.status) && payload?.code === "42501",
    `${name} RPC의 익명 실행이 차단되지 않았습니다. (HTTP ${response.status})`
  );
}

async function loadEnv(path) {
  const source = await readFile(path, "utf8");
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
        return [key, value];
      })
  );
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { message: text || response.statusText };
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function formatError(value) {
  return value?.message ?? value?.code ?? "알 수 없는 오류";
}
