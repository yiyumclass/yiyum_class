import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const modulePath = process.env.PGLITE_MODULE_PATH;
if (!modulePath) throw new Error("Set PGLITE_MODULE_PATH to an isolated PGlite installation.");
const { PGlite } = await import(pathToFileURL(modulePath).href);
const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
const migrations = await Promise.all((await readdir(migrationDirectory)).sort().map(async name => ({
  name, sql: await readFile(new URL(name, migrationDirectory), "utf8"),
})));
const database = new PGlite();
const buyerId = "10000000-0000-0000-0000-000000000001";
const ownerId = "10000000-0000-0000-0000-000000000002";
const otherId = "10000000-0000-0000-0000-000000000003";
const rows = async (sql, values = []) => (await database.query(sql, values)).rows;

function definition(pattern, latest = false) {
  const matches = migrations.flatMap(migration => [...migration.sql.matchAll(pattern)].map(match => ({ sql: match[0], file: migration.name })));
  assert.ok(matches.length, `Missing migration definition: ${pattern}`);
  return latest ? matches.at(-1).sql : matches[0].sql;
}

try {
  await database.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
    create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end;$$;
  `);
  for (const table of ["products", "orders", "product_entitlements", "admin_users", "admin_audit_logs", "payment_refunds"]) {
    await database.exec(definition(new RegExp(`create table (?:if not exists )?public\\.${table} \\([\\s\\S]*?\\n\\);`, "g")));
  }
  await database.exec("alter table orders add column refund_policy_version text, add column refund_policy_agreed_at timestamptz;");
  await database.exec("alter table products add column detail_body text, add column list_price_krw integer, add column file_path text;");
  for (const name of ["is_admin", "get_public_products", "generate_order_uid", "create_toss_payment_order", "record_toss_refund_policy_consent", "fail_toss_payment_order", "complete_toss_payment_server", "begin_toss_refund_server", "complete_toss_refund_server"]) {
    await database.exec(definition(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "g"), true));
  }
  const refundMigration = migrations.find(migration => migration.name === "20260722130000_create_toss_refund_flow.sql");
  const indexes = [...refundMigration.sql.matchAll(/create unique index if not exists payment_refunds_[\s\S]*?;/g)];
  for (const index of indexes) await database.exec(index[0]);
  await database.exec(migrations.find(migration => migration.name === "20260923090000_create_payment_notifications.sql").sql);
  await database.query("insert into auth.users values ($1),($2),($3)", [buyerId, ownerId, otherId]);
  await database.query("insert into admin_users(user_id,role,is_active) values($1,'owner',true)", [ownerId]);
  await database.exec("insert into products(slug,product_type,title,price_krw,status,access_period_days) values('sns-monetization-feedback','course','QA',1200000,'active',365)");
  await database.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)", [buyerId]);
  const createOrder = async () => (await rows("select * from create_toss_payment_order('sns-monetization-feedback')"))[0];
  const canceled = await createOrder();
  assert.equal((await createOrder()).order_uid, canceled.order_uid, "pending request reuses one order");
  await rows("select fail_toss_payment_order($1)", [canceled.order_uid]);
  const order = await createOrder();
  assert.notEqual(order.order_uid, canceled.order_uid, "retry after cancellation creates a fresh order");
  assert.equal((await rows("select count(*)::int as count from product_entitlements"))[0].count, 0);
  await rows("select record_toss_refund_policy_consent($1,'2026-07-29')", [order.order_uid]);
  const complete = (userId = buyerId, amount = order.amount, key = "qa-payment") => rows("select * from complete_toss_payment_server($1,$2,$3,$4,$5)", [userId, order.order_uid, key, amount, "2026-10-03T06:00:00Z"]);
  await assert.rejects(complete(), /service role required/);
  await database.exec("select set_config('request.jwt.claim.role','service_role',false)");
  await assert.rejects(complete(otherId), /order owner mismatch/);
  await assert.rejects(complete(buyerId, 1), /order verification failed/);
  await complete();
  await Promise.all([complete(), complete(), complete()]);
  assert.equal((await rows("select count(*)::int as count from orders where status='paid'"))[0].count, 1);
  assert.equal((await rows("select count(*)::int as count from product_entitlements where status='active'"))[0].count, 1);
  assert.equal((await rows("select count(*)::int as count from payment_notifications"))[0].count, 1);
  assert.equal(new Date((await rows("select expires_at from product_entitlements"))[0].expires_at).toISOString(), "2027-10-03T06:00:00.000Z");
  await assert.rejects(complete(buyerId, order.amount, "other-payment"), /another payment/);
  assert.equal((await rows("select fail_toss_payment_order($1) as changed", [order.order_uid]))[0].changed, false);
  await assert.rejects(createOrder(), /active entitlement already exists/);
  const orderId = (await rows("select id from orders where order_uid=$1", [order.order_uid]))[0].id;
  const beginRefund = (actor = ownerId) => rows("select * from begin_toss_refund_server($1,$2,'RFD-QA','qa-refund-idempotency','QA test refund')", [orderId, actor]);
  await assert.rejects(beginRefund(otherId), /owner role required/);
  const refund = (await beginRefund())[0];
  assert.equal((await beginRefund())[0].refund_id, refund.refund_id, "retry reuses refund and idempotency key");
  const settleRefund = (refundUid = refund.refund_uid) => rows("select * from complete_toss_refund_server($1,'qa-payment',$2,$3,'qa-cancel-transaction',$4,$5,'QA test refund')", [order.order_uid, order.amount, "2026-10-03T06:01:00Z", refundUid, ownerId]);
  await settleRefund();
  await settleRefund(null);
  await settleRefund(null);
  assert.equal((await rows("select status from orders where id=$1", [orderId]))[0].status, "refunded");
  assert.equal((await rows("select status from product_entitlements"))[0].status, "revoked");
  assert.equal((await rows("select count(*)::int as count from payment_refunds where status='succeeded'"))[0].count, 1);
  assert.equal((await rows("select count(*)::int as count from admin_audit_logs where action='payment.refunded'"))[0].count, 1);
  assert.equal((await rows("select * from claim_payment_notification($1)", [order.order_uid])).length, 0, "refunded payment cannot send queued notification");
  await assert.rejects(complete(), /order is not pending/);
  await assert.rejects(beginRefund(), /already refunded/);
  console.log("PASS: isolated PostgreSQL order/cancel/retry, ownership/amount/role validation, approval replay, single entitlement/notification, expiry, refund retry, duplicate cancellation, revocation and post-refund rejection");

  await database.exec(migrations.find(migration => migration.name === "20261004100000_add_owner_payment_verification.sql").sql);
  const verificationSlug = "admin-payment-verification-100";
  const createVerification = () => rows("select * from create_toss_payment_order($1)", [verificationSlug]);
  const setActor = (userId) => rows("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)", [userId]);
  assert.equal((await rows("select * from get_public_products($1)", [verificationSlug])).length, 0);
  assert.ok((await rows("select * from get_public_products(null)")).every(product => product.slug !== verificationSlug));
  await setActor("");
  await assert.rejects(createVerification(), /authentication required/);
  await setActor(buyerId);
  await assert.rejects(createVerification(), /owner role required/);
  await rows("insert into admin_users(user_id,role,is_active) values($1,'operator',true)", [otherId]);
  await setActor(otherId);
  await assert.rejects(createVerification(), /owner role required/);
  await setActor(ownerId);
  await rows("update admin_users set is_active=false where user_id=$1", [ownerId]);
  await assert.rejects(createVerification(), /owner role required/);
  await rows("update admin_users set is_active=true where user_id=$1", [ownerId]);
  await assert.rejects(rows("update products set price_krw=1 where slug=$1", [verificationSlug]), /products_payment_verification_restricted/);
  await assert.rejects(rows("update products set status='active' where slug=$1", [verificationSlug]), /products_payment_verification_restricted/);
  await assert.rejects(rows("update products set access_period_days=null where slug=$1", [verificationSlug]), /products_payment_verification_restricted/);
  await rows("insert into products(slug,product_type,title,price_krw,status) values('other-draft','course','Draft',100,'draft')");
  await assert.rejects(rows("select * from create_toss_payment_order('other-draft')"), /active product not found/);
  const verificationOrder = (await createVerification())[0];
  assert.equal(verificationOrder.amount, 100);
  assert.equal((await createVerification())[0].order_uid, verificationOrder.order_uid);
  await rows("select record_toss_refund_policy_consent($1,'2026-07-29')", [verificationOrder.order_uid]);
  await database.exec("select set_config('request.jwt.claim.role','service_role',false)");
  await rows("select * from complete_toss_payment_server($1,$2,'qa-100-payment',100,now())", [ownerId, verificationOrder.order_uid]);
  assert.equal((await rows("select count(*)::int as count from product_entitlements where user_id=$1 and status='active'", [ownerId]))[0].count, 1);
  const verificationOrderId = (await rows("select id from orders where order_uid=$1", [verificationOrder.order_uid]))[0].id;
  const verificationRefund = (await rows("select * from begin_toss_refund_server($1,$2,'RFD-QA-100','qa-100-refund','100 KRW verification')", [verificationOrderId, ownerId]))[0];
  await rows("select * from complete_toss_refund_server($1,'qa-100-payment',100,now(),'qa-100-cancel',$2,$3,'100 KRW verification')", [verificationOrder.order_uid, verificationRefund.refund_uid, ownerId]);
  assert.equal((await rows("select status from orders where id=$1", [verificationOrderId]))[0].status, "refunded");
  assert.equal((await rows("select status from product_entitlements where user_id=$1", [ownerId]))[0].status, "revoked");
  await rows("update products set status='archived' where slug=$1", [verificationSlug]);
  await assert.rejects(createVerification(), /active product not found/);
  assert.equal((await rows("select price_krw from products where slug='sns-monetization-feedback'"))[0].price_krw, 1200000);
  console.log("PASS: owner-only 100 KRW verification, hidden catalog, anonymous/member/operator/inactive-owner rejection, fixed price, no unrelated draft checkout, shared approval/refund and archival");
} finally {
  await database.close();
}
