import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPaymentDbFixture } from "./payment-db-fixture.mjs";

const fixture = await createPaymentDbFixture();

try {
  await fixture.exec(`
    create schema cron;
    create table cron.job (jobid bigint primary key, jobname text);
    create table cron.job_run_details (jobid bigint, end_time timestamptz);
    create schema vault;
    create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
    create schema net;
    create table net.http_request_queue (
      id bigint generated always as identity primary key,
      url text, headers jsonb, timeout_milliseconds integer
    );
    create table net._http_response (id bigint);
    create function net.http_get(url text, params jsonb default '{}'::jsonb,
      headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 2000)
    returns bigint language sql as $$
      insert into net.http_request_queue(url, headers, timeout_milliseconds)
      values ($1, $3, $4) returning id;
    $$;
    grant usage on schema net to public;
    grant select on net.http_request_queue, net._http_response to public;
  `);
  const migration = await readFile(
    new URL("../supabase/migrations/20261005090000_schedule_payment_recovery.sql", import.meta.url),
    "utf8"
  );
  const executable = migration.replace(/^create extension[^;]+;\s*/gm, "");
  await fixture.exec(executable);
  await fixture.exec(executable);

  await assert.rejects(fixture.rows("select payment_ops.invoke_payment_recovery()"), /configuration missing or invalid/);
  await fixture.rows("insert into vault.decrypted_secrets values ($1,$2),($3,$4)", [
    "yiyume_payment_recovery_url", "https://yiyumeclass.vercel.app/api/cron/reconcile-payments",
    "yiyume_payment_recovery_cron_secret", "isolated-test-secret-not-a-real-credential",
  ]);
  await fixture.exec(`
    insert into cron.job values (1,'yiyume-payment-recovery'),(2,'unrelated-job');
    insert into cron.job_run_details values
      (1,now()-interval '8 days'),(1,now()),(2,now()-interval '8 days');
    insert into payment_ops.recovery_http_requests values (-1,now()-interval '8 days');
  `);
  const result = await fixture.rows("select payment_ops.invoke_payment_recovery() as request_id");
  assert.equal(result.length, 1);
  const requests = await fixture.rows("select * from net.http_request_queue");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://yiyumeclass.vercel.app/api/cron/reconcile-payments");
  assert.equal(requests[0].headers.Authorization, "Bearer isolated-test-secret-not-a-real-credential");
  assert.equal(requests[0].timeout_milliseconds, 65000);
  assert.equal((await fixture.rows("select * from payment_ops.recovery_http_requests")).length, 1);
  assert.equal((await fixture.rows("select * from cron.job_run_details")).length, 2);

  for (const role of ["anon", "authenticated", "service_role"]) {
    const [permissions] = await fixture.rows(`select
      has_schema_privilege($1,'payment_ops','usage') as schema_usage,
      has_function_privilege($1,'payment_ops.invoke_payment_recovery()','execute') as can_execute`, [role]);
    assert.equal(permissions.schema_usage, false);
    assert.equal(permissions.can_execute, false);
  }
  for (const role of ["anon", "authenticated"]) {
    const [permissions] = await fixture.rows(`select
      has_table_privilege($1,'net.http_request_queue','select') as can_read_request,
      has_table_privilege($1,'net._http_response','select') as can_read_response`, [role]);
    assert.equal(permissions.can_read_request, false);
    assert.equal(permissions.can_read_response, false);
  }
  for (const invalidUrl of ["http://yiyumeclass.vercel.app/api/cron/reconcile-payments", "https://example.com/other-route"]) {
    await fixture.rows("update vault.decrypted_secrets set decrypted_secret=$1 where name='yiyume_payment_recovery_url'", [invalidUrl]);
    await assert.rejects(fixture.rows("select payment_ops.invoke_payment_recovery()"), /configuration missing or invalid/);
  }
  assert.equal((await fixture.rows("select * from net.http_request_queue")).length, 1);
  console.log(`PASS: scheduler SQL (${fixture.kind}), idempotent install, Vault-only configuration, restricted privileges, HTTPS endpoint, bounded timeout and scoped history retention. HTTP transport is stubbed; no external request.`);
} finally {
  await fixture.close();
}
