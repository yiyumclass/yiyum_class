import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPaymentDbFixture, ids } from "./payment-db-fixture.mjs";

const fixture = await createPaymentDbFixture();
const rows = fixture.rows;
const migration = await readFile(new URL("../supabase/migrations/20261005130000_harden_notification_contacts.sql", import.meta.url), "utf8");

try {
  await fixture.exec(migration);
  await fixture.setActor(null, "service_role");
  await rows("insert into user_notification_contacts(user_id,kakao_user_id,phone) values($1,'123','01012345678')", [ids.buyer]);
  await assert.rejects(fixture.exec("set role authenticated; select * from user_notification_contacts"), /permission denied/);
  await assert.rejects(fixture.exec("set role authenticated; insert into user_notification_contacts(user_id,kakao_user_id,phone) values(gen_random_uuid(),'456','01012345678')"), /permission denied/);
  await fixture.exec("reset role");
  await fixture.setActor(ids.buyer);
  await assert.rejects(rows("select * from get_payment_notification_health()"), /service role required/);
  const [order] = await rows("select * from create_toss_payment_order('sns-monetization-feedback')");
  await fixture.setActor(null, "service_role");
  await rows("select bind_toss_order_mode_server($1,$2,'toss_live')", [ids.buyer, order.order_uid]);
  await rows("update orders set status='paid',approved_at=now() where order_uid=$1", [order.order_uid]);
  const [storedOrder] = await rows("select * from orders where order_uid=$1", [order.order_uid]);
  await rows("insert into product_entitlements(user_id,product_id,source,status,granted_at,payment_order_id) values($1,$2,'payment','active',now(),$3)", [ids.buyer, ids.feedbackProduct, storedOrder.id]);

  const claim = async () => rows("select * from claim_payment_notification($1)", [order.order_uid]);
  const concurrentClaims = await Promise.all([claim(), claim(), claim()]);
  assert.equal(concurrentClaims.flat().length, 1, "one worker owns the notification");
  let [job] = concurrentClaims.flat();
  assert.ok(job);
  assert.equal((await claim()).length, 0);
  await rows("update payment_notifications set status='waiting_contact',error_code='PHONE_UNAVAILABLE' where order_id=$1", [storedOrder.id]);
  assert.equal((await claim()).length, 0, "missing contact is not blindly retried");
  await rows("update payment_notifications set created_at=now()-interval '8 days' where order_id=$1", [storedOrder.id]);
  await rows("update user_notification_contacts set phone='01087654321' where user_id=$1", [ids.buyer]);
  assert.equal((await rows("select status from payment_notifications where order_id=$1", [storedOrder.id]))[0].status, "waiting_contact", "old notices require manual review");
  await rows("update payment_notifications set created_at=now() where order_id=$1", [storedOrder.id]);
  await rows("update user_notification_contacts set phone='01087654321' where user_id=$1", [ids.buyer]);
  let [notice] = await rows("select * from payment_notifications where order_id=$1", [storedOrder.id]);
  assert.equal(notice.status, "pending");
  assert.equal(notice.attempts, 0);
  [job] = await claim();
  const begin = async token => (await rows("select begin_payment_notification_send($1,$2,'template') as started", [storedOrder.id, token]))[0].started;
  assert.equal(await begin("00000000-0000-0000-0000-000000000000"), false);
  assert.equal(await begin(job.attempt_id), true);
  assert.equal(await begin(job.attempt_id), false);
  [notice] = await rows("select * from payment_notifications where order_id=$1", [storedOrder.id]);
  assert.ok(notice.send_started_at);
  for (const status of ["sending", "unknown", "accepted", "delivered", "delivery_failed", "review"]) {
    await rows("update payment_notifications set status=$1,next_attempt_at=now()-interval '1 day' where order_id=$2", [status, storedOrder.id]);
    await rows("update user_notification_contacts set phone='01087654321' where user_id=$1", [ids.buyer]);
    assert.equal((await claim()).length, 0, `${status} never resends after contact refresh`);
  }
  await rows("update payment_notifications set status='failed',attempts=0,provider_message_id='already-accepted',provider_group_id='group',next_attempt_at=now() where order_id=$1", [storedOrder.id]);
  assert.equal((await claim()).length, 0, "provider IDs block duplicate attempts even if status is wrong");
  await rows("update payment_notifications set status='pending',provider_message_id=null,provider_group_id=null where order_id=$1", [storedOrder.id]);
  await rows("delete from product_entitlements where payment_order_id=$1", [storedOrder.id]);
  await rows("insert into product_entitlements(user_id,product_id,source,status,granted_at,expires_at,payment_order_id) values($1,$2,'payment','active',now(),now()-interval '1 day',$3)", [ids.buyer, ids.feedbackProduct, storedOrder.id]);
  assert.equal((await claim()).length, 0, "expired access cannot receive a payment welcome");
  await rows("delete from product_entitlements where payment_order_id=$1", [storedOrder.id]);
  await rows("insert into product_entitlements(user_id,product_id,source,status,granted_at,payment_order_id) values($1,$2,'payment','active',now(),$3)", [ids.buyer, ids.feedbackProduct, storedOrder.id]);
  [job] = await claim();
  assert.ok(job);
  await rows("insert into payment_refunds(order_id,refund_uid,amount,reason,idempotency_key) values($1,'notification-refund',100,'refund requested','notification-refund')", [storedOrder.id]);
  for (const refundStatus of ["requested", "processing", "succeeded"]) {
    await rows("update payment_refunds set status=$1 where order_id=$2", [refundStatus, storedOrder.id]);
    assert.equal(await begin(job.attempt_id), false, `${refundStatus} refund blocks send even before order status changes`);
  }
  await rows("update payment_refunds set status='failed' where order_id=$1", [storedOrder.id]);
  await rows("update orders set status='refunded' where id=$1", [storedOrder.id]);
  assert.equal(await begin(job.attempt_id), false, "refund before send blocks message");
  await rows("update orders set status='paid' where id=$1", [storedOrder.id]);
  await rows("insert into account_withdrawals(user_id,provider) values($1,'kakao')", [ids.buyer]);
  assert.equal((await rows("select * from user_notification_contacts where user_id=$1", [ids.buyer])).length, 0, "withdrawal removes contact");
  assert.equal(await begin(job.attempt_id), false, "withdrawn account cannot send");
  await assert.rejects(rows("insert into user_notification_contacts(user_id,kakao_user_id,phone) values($1,'123','01012345678')", [ids.buyer]), /account_inactive/);
  await rows("insert into user_notification_contacts(user_id,kakao_user_id,phone) values($1,'456','01012345678')", [ids.other]);
  await rows("update auth.users set deleted_at=now() where id=$1", [ids.other]);
  assert.equal((await rows("select * from user_notification_contacts where user_id=$1", [ids.other])).length, 0, "soft deletion removes contact");
  await assert.rejects(rows("insert into user_notification_contacts(user_id,kakao_user_id,phone) values($1,'456','01012345678')", [ids.other]), /account_inactive/);
  await rows("insert into user_notification_contacts(user_id,kakao_user_id,phone) values($1,'789','01012345678')", [ids.owner]);
  await rows("delete from auth.users where id=$1", [ids.owner]);
  assert.equal((await rows("select * from user_notification_contacts where user_id=$1", [ids.owner])).length, 0, "hard deletion cascades contact removal");
  const [health] = await rows("select * from get_payment_notification_health()");
  assert.ok(health);
  await verifiesSchedulerWithoutNetwork();
  console.log(`PASS: notification recovery (${fixture.kind}), contact permissions/deletion, waiting-contact resume, concurrent duplicate protection, sender fencing, refund/withdrawal checks, isolated scheduler`);
} finally {
  await fixture.close();
}

async function verifiesSchedulerWithoutNetwork() {
  await fixture.exec(`
    create schema payment_ops;
    create schema vault;
    create table vault.decrypted_secrets(name text primary key, decrypted_secret text);
    create schema cron;
    create table cron.job(jobid bigint primary key, jobname text);
    create table cron.job_run_details(jobid bigint, end_time timestamptz);
    create schema net;
    create table net.mock_requests(id bigserial primary key, url text, headers jsonb, timeout_milliseconds integer);
    create function net.http_get(url text, headers jsonb, timeout_milliseconds integer) returns bigint language sql as $$
      insert into net.mock_requests(url,headers,timeout_milliseconds) values($1,$2,$3) returning id
    $$;
  `);
  const schedulerMigration = await readFile(new URL("../supabase/migrations/20261005131000_prepare_notification_scheduler.sql", import.meta.url), "utf8");
  await fixture.exec(schedulerMigration);
  const [tableSecurity] = await rows("select relrowsecurity from pg_class where oid='payment_ops.notification_http_requests'::regclass");
  assert.equal(tableSecurity.relrowsecurity, true, "scheduler request history has RLS enabled");
  assert.equal((await rows("select * from cron.job")).length, 0, "migration never enables a live job");
  assert.equal((await rows("select * from net.mock_requests")).length, 0);
  await assert.rejects(rows("select payment_ops.invoke_payment_notifications()"), /configuration missing/);
  await rows("insert into vault.decrypted_secrets values('yiyume_payment_recovery_url','https://notifications.example.test/api/cron/reconcile-payments'),('yiyume_payment_recovery_cron_secret',repeat('x',32))");
  await rows("insert into cron.job values(1,'yiyume-payment-recovery'),(2,'yiyume-payment-notifications')");
  await rows("insert into cron.job_run_details values(1,now()-interval '8 days'),(2,now()-interval '8 days'),(2,now())");
  const [invocation] = await rows("select payment_ops.invoke_payment_notifications() as request_id");
  const [request] = await rows("select * from net.mock_requests where id=$1", [invocation.request_id]);
  assert.equal(request.url, "https://notifications.example.test/api/cron/payment-notifications");
  assert.deepEqual(request.headers, { Authorization: `Bearer ${"x".repeat(32)}` });
  assert.equal(request.timeout_milliseconds, 65000);
  assert.equal((await rows("select * from payment_ops.notification_http_requests where request_id=$1", [invocation.request_id])).length, 1);
  assert.equal((await rows("select * from cron.job_run_details where jobid=1")).length, 1, "payment recovery history is untouched");
  assert.equal((await rows("select * from cron.job_run_details where jobid=2")).length, 1);
  for (const role of ["anon", "authenticated", "service_role"]) {
    const [privileges] = await rows("select has_table_privilege($1,'payment_ops.notification_http_requests','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as allowed", [role]);
    assert.equal(privileges.allowed, false, `${role} has no scheduler history table privileges`);
    await assert.rejects(fixture.exec(`set role ${role}; select * from payment_ops.notification_http_requests`), /permission denied/);
    await fixture.exec("reset role");
    await assert.rejects(fixture.exec(`set role ${role}; select payment_ops.invoke_payment_notifications()`), /permission denied/);
    await fixture.exec("reset role");
  }
  await rows("update vault.decrypted_secrets set decrypted_secret='https://unexpected.example.test/other' where name='yiyume_payment_recovery_url'");
  await assert.rejects(rows("select payment_ops.invoke_payment_notifications()"), /configuration missing/);
  assert.equal((await rows("select * from net.mock_requests")).length, 1, "invalid scheduler config never calls the endpoint");
}
