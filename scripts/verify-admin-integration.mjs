import { readFile } from "node:fs/promises";

const env = await loadEnv(".env.local");
const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

const productsResponse = await fetch(
  `${baseUrl}/rest/v1/products?select=slug,product_type,status,price_krw&status=eq.active&order=slug`,
  { headers }
);
const products = await readJson(productsResponse);
assert(productsResponse.ok && Array.isArray(products), "판매 상품 조회에 실패했습니다.");
assert(products.length > 0, "판매 중인 테스트 상품이 없습니다.");
assert(
  products.every((product) => product.price_krw === 0),
  "무료 신청 모드인데 0원이 아닌 판매 중 상품이 있습니다."
);

const claimResponse = await fetch(`${baseUrl}/rest/v1/rpc/claim_free_product`, {
  method: "POST",
  headers,
  body: JSON.stringify({ target_product_slug: "__integration-smoke-check__" }),
});
const claimBody = await readJson(claimResponse);
assert(
  claimBody?.code !== "PGRST202",
  "무료 신청 RPC가 배포되지 않았습니다."
);

console.log(`✓ 공개 커리큘럼 RPC: ${outlineBody.length}행`);
console.log(`✓ 판매 중 무료 상품: ${products.length}개`);
console.log("✓ 무료 신청 RPC: 배포 확인");

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
