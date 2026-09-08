import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260829120000_grant_owner_admin_to_ymyi98.sql",
    import.meta.url
  ),
  "utf8"
);

test("운영 계정을 이메일로 찾아 owner 관리자로 활성화한다", () => {
  assert.match(migration, /from auth\.users as account/i);
  assert.match(migration, /lower\(account\.email\)\s*=\s*lower\('ymyi98@naver\.com'\)/i);
  assert.match(migration, /'owner'/i);
  assert.match(migration, /'이윰'/);
  assert.match(migration, /is_active\s*=\s*true/i);
});

test("관리자 승격은 재실행해도 중복되지 않고 로컬 Auth 계정 부재를 허용한다", () => {
  assert.match(migration, /if target_user_id is null then/i);
  assert.match(migration, /raise notice 'Admin bootstrap skipped/i);
  assert.match(migration, /on conflict \(user_id\)\s+do update set/i);
  assert.doesNotMatch(migration, /user_metadata|app_metadata/i);
});
