import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

const env = await loadEnv(".env.local");
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = process.env.ADMIN_TEST_BASE_URL ?? "http://localhost:3001";

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("Supabase URL, anon key와 테스트용 service role key가 필요합니다.");
}

const runId = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const password = `Yiyume!${randomBytes(18).toString("base64url")}`;
const adminEmail = `admin-e2e-${runId}@example.com`;
const memberEmail = `member-e2e-${runId}@example.com`;
const createdUserIds = [];
let entitlementId = null;
const checks = [];

try {
  const [adminUser, memberUser] = await Promise.all([
    createAuthUser(adminEmail, password, "E2E 관리자"),
    createAuthUser(memberEmail, password, "E2E 회원"),
  ]);
  createdUserIds.push(adminUser.id, memberUser.id);

  await serviceRest("admin_users", {
    method: "POST",
    body: {
      user_id: adminUser.id,
      role: "operator",
      display_name: "E2E 관리자",
      created_by: null,
    },
  });
  pass("임시 관리자·회원 생성 및 관리자 역할 연결");

  const [adminSession, memberSession] = await Promise.all([
    signIn(adminEmail, password),
    signIn(memberEmail, password),
  ]);
  pass("Supabase Auth 이메일 로그인");

  const products = await serviceRest(
    "products?select=id,title&status=neq.archived&order=created_at.asc&limit=1"
  );
  const product = products[0];
  if (!product) throw new Error("테스트에 사용할 상품이 없습니다.");

  const initialMembers = await rpc(
    "get_admin_member_entitlements",
    {},
    adminSession.access_token
  );
  assert(
    initialMembers.some((row) => row.member_id === memberUser.id),
    "회원 탭 조회 RPC에서 임시 회원을 찾지 못했습니다."
  );
  pass("회원 목록 RPC 조회");

  const firstExpiration = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  entitlementId = await rpc(
    "admin_grant_product_entitlement",
    {
      target_user_id: memberUser.id,
      target_product_id: product.id,
      target_expires_at: firstExpiration,
    },
    adminSession.access_token
  );
  assert(typeof entitlementId === "string", "수강권 지급 결과 ID가 올바르지 않습니다.");
  pass("관리자 수강권 지급 RPC");

  const [membersAfterGrant, ordersAfterGrant] = await Promise.all([
    rpc("get_admin_member_entitlements", {}, adminSession.access_token),
    rpc("get_admin_order_ledger", {}, adminSession.access_token),
  ]);
  assert(
    membersAfterGrant.some(
      (row) =>
        row.entitlement_id === entitlementId &&
        row.member_id === memberUser.id &&
        row.entitlement_status === "active" &&
        row.entitlement_source === "admin_grant"
    ),
    "지급한 수강권이 회원 탭 RPC에 반영되지 않았습니다."
  );
  assert(
    ordersAfterGrant.some(
      (row) =>
        row.transaction_id === entitlementId &&
        row.customer_id === memberUser.id &&
        row.entitlement_status === "active" &&
        row.source === "admin_grant" &&
        row.amount_krw === 0
    ),
    "지급한 수강권이 주문 탭 RPC에 반영되지 않았습니다."
  );
  pass("수강권 지급 → 회원 탭·주문 탭 동시 반영");

  const adminCookie = buildSupabaseCookie(adminSession, supabaseUrl);
  await assertPage("/admin/members", adminCookie, [
    "회원 · 수강권",
    memberEmail,
    product.title,
  ]);
  await assertPage("/admin/orders", adminCookie, [
    "주문 · 결제",
    memberEmail,
    product.title,
    "관리자 지급",
  ]);
  pass("Next.js 관리자 두 페이지의 실제 SSR 데이터 표시");

  await rpc(
    "admin_update_product_entitlement",
    {
      target_entitlement_id: entitlementId,
      target_status: "revoked",
      target_expires_at: firstExpiration,
    },
    adminSession.access_token
  );
  const ordersAfterRevoke = await rpc(
    "get_admin_order_ledger",
    {},
    adminSession.access_token
  );
  assert(
    ordersAfterRevoke.some(
      (row) => row.transaction_id === entitlementId && row.entitlement_status === "revoked"
    ),
    "회수한 수강권이 주문 탭에 반영되지 않았습니다."
  );
  await assertPage("/admin/orders", adminCookie, [memberEmail, "회수됨"]);
  pass("수강권 회수 → 주문 탭 상태 반영");

  const secondExpiration = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await rpc(
    "admin_update_product_entitlement",
    {
      target_entitlement_id: entitlementId,
      target_status: "active",
      target_expires_at: secondExpiration,
    },
    adminSession.access_token
  );
  const membersAfterRestore = await rpc(
    "get_admin_member_entitlements",
    {},
    adminSession.access_token
  );
  assert(
    membersAfterRestore.some(
      (row) =>
        row.entitlement_id === entitlementId &&
        row.entitlement_status === "active" &&
        sameInstant(row.expires_at, secondExpiration)
    ),
    "수강권 재활성화 또는 만료일 변경이 반영되지 않았습니다."
  );
  pass("수강권 재활성화와 만료일 변경");

  const audits = await serviceRest(
    `admin_audit_logs?select=action&target_id=eq.${encodeURIComponent(entitlementId)}`
  );
  const auditActions = new Set(audits.map((entry) => entry.action));
  for (const action of [
    "entitlement.granted",
    "entitlement.revoked",
    "entitlement.updated",
  ]) {
    assert(auditActions.has(action), `감사 로그 ${action} 기록이 없습니다.`);
  }
  pass("지급·회수·재활성화 감사 로그 기록");

  const denied = await rpcExpectError(
    "admin_update_product_entitlement",
    {
      target_entitlement_id: entitlementId,
      target_status: "revoked",
      target_expires_at: secondExpiration,
    },
    memberSession.access_token
  );
  assert(
    [401, 403].includes(denied.status) && denied.body.code === "42501",
    `일반 회원 변경 요청이 차단되지 않았습니다. (HTTP ${denied.status}, ${denied.body.code ?? "코드 없음"})`
  );
  pass("일반 회원의 수강권 변경 차단");

  console.log(`\n${checks.length}개 통합 검증 통과`);
} finally {
  if (entitlementId) {
    await serviceRest(
      `admin_audit_logs?target_id=eq.${encodeURIComponent(entitlementId)}`,
      { method: "DELETE", allowEmpty: true }
    ).catch(() => undefined);
  }

  for (const userId of createdUserIds.reverse()) {
    await deleteAuthUser(userId).catch(() => undefined);
  }

  if (createdUserIds.length > 0) {
    const remainingAdmins = await serviceRest(
      `admin_users?select=user_id&user_id=in.(${createdUserIds.join(",")})`
    ).catch(() => []);
    const remainingEntitlements = await serviceRest(
      `product_entitlements?select=id&user_id=in.(${createdUserIds.join(",")})`
    ).catch(() => []);
    assert(remainingAdmins.length === 0, "임시 관리자 데이터 정리에 실패했습니다.");
    assert(remainingEntitlements.length === 0, "임시 수강권 데이터 정리에 실패했습니다.");
  }

  if (entitlementId) {
    const remainingAudits = await serviceRest(
      `admin_audit_logs?select=id&target_id=eq.${encodeURIComponent(entitlementId)}`
    ).catch(() => []);
    assert(remainingAudits.length === 0, "임시 감사 로그 데이터 정리에 실패했습니다.");
  }

  console.log("임시 테스트 회원·관리자·수강권 데이터 정리 완료");
}

async function createAuthUser(email, userPassword, name) {
  return requestJson(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      email,
      password: userPassword,
      email_confirm: true,
      user_metadata: { name },
    }),
  });
}

async function deleteAuthUser(userId) {
  return requestJson(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: serviceHeaders(),
    allowEmpty: true,
  });
}

async function signIn(email, userPassword) {
  return requestJson(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password: userPassword }),
  });
}

async function rpc(name, body, accessToken) {
  return requestJson(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: userHeaders(accessToken),
    body: JSON.stringify(body),
  });
}

async function rpcExpectError(name, body, accessToken) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: userHeaders(accessToken),
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function serviceRest(path, options = {}) {
  return requestJson(`${supabaseUrl}/rest/v1/${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...serviceHeaders(),
      Prefer: options.method === "POST" ? "return=minimal" : "return=representation",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    allowEmpty: options.allowEmpty ?? options.method === "POST",
  });
}

async function assertPage(path, cookie, fragments) {
  const response = await fetch(`${appUrl}${path}`, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  const text = await response.text();
  assert(response.status === 200, `${path} 응답이 HTTP ${response.status}입니다.`);
  for (const fragment of fragments) {
    assert(text.includes(fragment), `${path} HTML에 '${fragment}'가 없습니다.`);
  }
}

function buildSupabaseCookie(session, baseUrl) {
  const projectRef = new URL(baseUrl).hostname.split(".")[0];
  const name = `sb-${projectRef}-auth-token`;
  const encoded = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  const chunkSize = 3000;
  if (encoded.length <= chunkSize) return `${name}=${encoded}`;
  return Array.from({ length: Math.ceil(encoded.length / chunkSize) }, (_, index) =>
    `${name}.${index}=${encoded.slice(index * chunkSize, (index + 1) * chunkSize)}`
  ).join("; ");
}

function serviceHeaders() {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
}

function userHeaders(accessToken) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

async function requestJson(url, options) {
  const { allowEmpty = false, ...fetchOptions } = options;
  const response = await fetch(url, fetchOptions);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${readErrorMessage(text)}`);
  }
  if (!text) return allowEmpty ? null : {};
  return JSON.parse(text);
}

function readErrorMessage(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed.message ?? parsed.code ?? "알 수 없는 오류";
  } catch {
    return text || "알 수 없는 오류";
  }
}

function sameInstant(first, second) {
  return new Date(first).getTime() === new Date(second).getTime();
}

function pass(message) {
  checks.push(message);
  console.log(`✓ ${message}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2"),
        ];
      })
  );
}
