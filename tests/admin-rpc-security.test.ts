import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260816130000_harden_admin_rpc_execute_privileges.sql",
    import.meta.url
  ),
  "utf8"
);

test("admin RPC migration removes implicit public execution by default", () => {
  assert.match(
    migration,
    /alter default privileges in schema public\s+revoke execute on functions from public;/i
  );
  assert.match(
    migration,
    /revoke all privileges on function %s from public, anon, authenticated/i
  );
});

test("admin RPC migration separates authenticated entry points from internal helpers", () => {
  assert.match(migration, /procedure\.proname like 'admin\\_%'/);
  assert.match(migration, /procedure\.proname like 'get\\_admin\\_%'/);
  assert.match(migration, /grant execute on function %s to service_role/i);
  assert.match(migration, /grant execute on function %s to authenticated/i);

  const authenticatedGrantSection = migration.split(
    "-- 브라우저에서 호출하는 진입점만 authenticated에 다시 연다."
  )[1];
  assert.ok(authenticatedGrantSection);
  assert.doesNotMatch(authenticatedGrantSection, /'admin_order_learning_stats'/);
  assert.doesNotMatch(authenticatedGrantSection, /'admin_product_available_lessons'/);
});
