// 별도 임시 디렉터리에 설치한 PGlite로 실제 PostgreSQL 문법과 상태 전이를 검증한다.
// PGLITE_MODULE_PATH=/tmp/.../node_modules/@electric-sql/pglite/dist/index.js node scripts/verify-payment-notifications-db.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const modulePath = process.env.PGLITE_MODULE_PATH;
if (!modulePath) throw new Error('Set PGLITE_MODULE_PATH to an isolated PGlite installation.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
    select set_config('request.jwt.claim.role','service_role',false);
    create table products(id uuid primary key, slug text);
    create table orders(id uuid primary key, order_uid text, user_id uuid, product_id uuid, amount integer, source text, status text, approved_at timestamptz);
    create table product_entitlements(user_id uuid, product_id uuid, status text, expires_at timestamptz);
    insert into products values('00000000-0000-0000-0000-000000000001','sns-monetization');
    insert into orders values('10000000-0000-0000-0000-000000000001','OLD','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',930000,'payment','paid',now());
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20260923090000_create_payment_notifications.sql', import.meta.url),'utf8'));
  const rows = async (sql,params=[]) => (await db.query(sql,params)).rows;
  const claim = async () => rows('select * from claim_payment_notification()');
  assert.equal((await rows('select * from payment_notifications')).length,0,'no historical backfill');
  await db.exec(`
    insert into orders select '10000000-0000-0000-0000-000000000002','NEW',user_id,product_id,amount,source,'pending',now() from orders where order_uid='OLD';
    update orders set status='paid' where order_uid='NEW';
    update orders set status='paid' where order_uid='OLD';
  `);
  assert.equal((await rows('select * from payment_notifications')).length,1,'only newly paid queued');
  assert.equal((await claim()).length,0,'wait for entitlement');
  await db.exec(`insert into product_entitlements select user_id,product_id,'active',now()+interval '365 days' from orders where order_uid='NEW'`);
  const claims = await Promise.all([claim(),claim()]);
  assert.equal(claims.flat().length,1,'only one claim');
  let job=claims.flat()[0];
  const begin = async (token) => (await rows('select begin_payment_notification_send($1,$2,$3) as started',[job.order_id,token,'TEMPLATE']))[0].started;
  assert.equal(await begin('30000000-0000-0000-0000-000000000000'),false,'wrong token cannot send');
  assert.equal(await begin(job.attempt_id),true);
  assert.equal(await begin(job.attempt_id),false,'repeat sending rejected');
  for(const status of ['sending','accepted','unknown']) {
    await db.query(`update payment_notifications set status=$1, updated_at=now()-interval '1 day'`,[status]);
    assert.equal((await claim()).length,0,`${status} never automatically retried`);
  }
  await db.exec(`update payment_notifications set status='failed',next_attempt_at=now()+interval '1 hour'`);
  assert.equal((await claim()).length,0,'retry respects delay');
  await db.exec(`update payment_notifications set next_attempt_at=now()-interval '1 hour'`);
  job=(await claim())[0];
  const oldToken=job.attempt_id;
  await db.exec(`update payment_notifications set updated_at=now()-interval '11 minutes'`);
  job=(await claim())[0];
  assert.notEqual(job.attempt_id,oldToken,'expired preparing claim replaced');
  assert.equal(await begin(oldToken),false,'old worker cannot send');
  await db.exec(`update orders set status='refunded' where order_uid='NEW'`);
  assert.equal(await begin(job.attempt_id),false,'refund before sending blocks message');
  await db.exec(`update payment_notifications set status='failed',next_attempt_at=now()-interval '1 hour';update orders set status='paid' where order_uid='NEW'`);
  assert.equal((await claim()).length,0,'three attempts maximum');
  await db.exec(`begin;insert into orders select '10000000-0000-0000-0000-000000000003','ROLLBACK',user_id,product_id,amount,source,'paid',now() from orders where order_uid='OLD';rollback;`);
  assert.equal((await rows('select * from payment_notifications')).length,1,'queue rolls back with payment');
  await db.exec(`insert into orders select '10000000-0000-0000-0000-000000000004','FREE',user_id,product_id,0,'free_checkout','paid',now() from orders where order_uid='OLD'`);
  assert.equal((await rows('select * from payment_notifications')).length,1,'free enrollment does not enqueue');
  await db.exec(`select set_config('request.jwt.claim.role','authenticated',false)`);
  await assert.rejects(claim(),/service role required/);
  await db.exec(`set role authenticated`);
  await assert.rejects(rows('select * from payment_notifications'),/permission denied/);
  await assert.rejects(claim(),/permission denied/);
  console.log('PASS: SQL migration, atomic claims, stale worker fencing, retry limits, refunds, transaction rollback, historical/free exclusion, role restrictions');
} finally {await db.close();}
