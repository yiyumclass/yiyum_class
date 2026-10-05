import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPaymentDbFixture, ids } from "./payment-db-fixture.mjs";

const fixture = await createPaymentDbFixture();
const rows = fixture.rows;

try {
  for (const name of ["20261005130000_harden_notification_contacts.sql", "20261005150000_create_admin_notifications.sql"]) {
    await fixture.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
  await fixture.setActor(null, "service_role");
  assert.equal((await rows("select relrowsecurity from pg_class where oid='admin_notifications'::regclass"))[0].relrowsecurity, true);
  await assert.rejects(fixture.exec("set role anon; select * from admin_notifications"), /permission denied/);
  await assert.rejects(fixture.exec("set role authenticated; select * from admin_notifications"), /permission denied/);
  await fixture.exec("reset role");

  const draft = async (template = "template", member = ids.buyer, phoneHash = member) => (await rows(`
    insert into admin_notifications(actor_user_id,user_id,template_id,template_name,template_fingerprint,channel_id,snapshot,variables,recipient_hash,recipient_masked)
    values($1,$2,$3,'안내','fingerprint','channel','{}','{}',$4,'010-****-5678') returning id`, [ids.owner, member, template, phoneHash]))[0].id;
  const begin = async (draftId, actor = ids.owner) => (await rows("select begin_admin_notification_send($1,$2) started", [draftId, actor]))[0].started;
  const first = await draft();
  await fixture.setActor(ids.owner, "authenticated");
  await assert.rejects(begin(first), /service role required/);
  await fixture.setActor(null, "service_role");
  await assert.rejects(begin(first, ids.other), /owner_required/);
  await rows("insert into admin_users(user_id,role,is_active) values($1,'operator',true)", [ids.other]);
  await assert.rejects(begin(first, ids.other), /owner_required/);
  await rows("update admin_users set is_active=false where user_id=$1", [ids.owner]);
  await assert.rejects(begin(first), /owner_required/);
  await rows("update admin_users set is_active=true where user_id=$1", [ids.owner]);
  assert.equal((await rows("select count(*)::int count from admin_audit_logs where action='notification.send'"))[0].count, 0);
  const concurrent = await Promise.all([begin(first), begin(first), begin(first)]);
  assert.equal(concurrent.filter(Boolean).length, 1);
  assert.equal((await rows("select count(*)::int count from admin_audit_logs where action='notification.send'"))[0].count, 1);
  const duplicate = await draft();
  for (const status of ["sending", "accepted", "delivered", "unknown", "review", "delivery_failed", "rejected"]) {
    await rows("update admin_notifications set status=$1 where id=$2", [status, first]);
    await assert.rejects(begin(duplicate), /duplicate_notification/, `${status} cannot be resent`);
  }
  const differentUserSamePhone = await draft("template", ids.other, ids.buyer);
  await assert.rejects(begin(differentUserSamePhone), /duplicate_notification/);
  const concurrentDrafts = await Promise.all([draft("concurrent"), draft("concurrent")]);
  const competed = await Promise.allSettled(concurrentDrafts.map(value => begin(value)));
  assert.equal(competed.filter(result => result.status === "fulfilled" && result.value).length, 1);

  const expired = await draft("expired");
  await rows("update admin_notifications set expires_at=now()-interval '1 second' where id=$1", [expired]);
  await assert.rejects(begin(expired), /preview_expired/);
  const wrongOwner = await draft("owner");
  await rows("update admin_users set role='owner' where user_id=$1", [ids.other]);
  await assert.rejects(begin(wrongOwner, ids.other), /draft_unavailable/);

  const [entitlement] = await rows("insert into product_entitlements(user_id,product_id,source,status) values($1,$2,'admin_grant','active') returning id", [ids.buyer, ids.feedbackProduct]);
  const cash = await draft("cash");
  await rows("update admin_notifications set entitlement_id=$1,product_id=$2,payment_notice=true where id=$3", [entitlement.id, ids.feedbackProduct, cash]);
  await rows("update product_entitlements set status='revoked' where id=$1", [entitlement.id]);
  await assert.rejects(begin(cash), /entitlement_unavailable/);
  await rows("update product_entitlements set status='active',expires_at=now()-interval '1 second' where id=$1", [entitlement.id]);
  await assert.rejects(begin(cash), /entitlement_unavailable/);
  await rows("update product_entitlements set expires_at=null,source='payment' where id=$1", [entitlement.id]);
  await assert.rejects(begin(cash), /entitlement_unavailable/);
  await rows("update product_entitlements set source='admin_grant' where id=$1", [entitlement.id]);
  const [order] = await rows("insert into orders(user_id,product_id,order_uid,amount,source,status,approved_at) values($1,$2,'cash-history',1200000,'admin_grant','paid',now()) returning id", [ids.buyer, ids.feedbackProduct]);
  await rows("insert into payment_notifications(order_id,status,template_id,provider_message_id,send_started_at) values($1,'delivered','cash','message',now())", [order.id]);
  await assert.rejects(begin(cash), /duplicate_notification/, "old manual cash notices block duplicates");
  await rows("delete from payment_notifications where order_id=$1", [order.id]);
  await rows("update orders set source='payment' where id=$1", [order.id]);
  await assert.rejects(begin(cash), /automatic_payment_notice/);
  await rows("update orders set source='admin_grant' where id=$1", [order.id]);
  const beforeFinancial = await rows("select amount,source,status from orders where id=$1", [order.id]);
  assert.equal(await begin(cash), true);
  assert.deepEqual(await rows("select amount,source,status from orders where id=$1", [order.id]), beforeFinancial);

  const withdrawn = await draft("withdrawn", ids.other);
  await rows("insert into account_withdrawals(user_id,provider) values($1,'kakao')", [ids.other]);
  assert.equal((await rows("select id from admin_notifications where user_id=$1", [ids.other])).length, 0);
  await assert.rejects(begin(withdrawn), /owner_required|draft_unavailable/);
  await assert.rejects(draft("withdrawn-new", ids.other), /account_inactive/);
  await rows("update auth.users set deleted_at=now() where id=$1", [ids.buyer]);
  assert.equal((await rows("select id from admin_notifications where user_id=$1", [ids.buyer])).length, 0);
  await assert.rejects(draft("soft-delete"), /account_inactive/);
  console.log(`PASS: admin notifications (${fixture.kind}), RLS, owner/actor checks, concurrency, duplicate/legacy cash/online protection, expiry, revoked access, financial immutability, withdrawal purge; no external requests`);
} finally {
  await fixture.close();
}
