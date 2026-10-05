import assert from "node:assert/strict";
import { createPaymentDbFixture, ids } from "./payment-db-fixture.mjs";

const TOSS_TEST_MODE = "toss_test";
const TOSS_LIVE_MODE = "toss_live";
const findings = [];

const fixture = await createPaymentDbFixture();
const rows = fixture.rows;
const rowsAs = fixture.rowsAs;

try {
  await verifiesRecoverySchemaContract();
  await rejectsBrowserRolesForServerRecoveryRpcs();
  await persistsPreparedApprovalBeforeFulfillment();
  await snapshotsNewRpcOrdersBeforeConfirmation();
  await rejectsReplayWithDifferentPaymentKey();
  await rejectsUnsupportedPaymentModes();
  await recordsVerifiedProviderStateForReconciliation();
  await blocksFreshChargeWhenApprovedOrderWasFailed();
  await preventsAttemptedOrdersFromBeingDemotedToFailed();
  await blocksWithdrawalWhilePaymentRecoveryOrRefundIsOpen();
  await settlesNullKeyCancellationAfterServerVerification();
  await ignoresPartialFailedRefundWhenFullCancelArrives();
  await reviewsLegacyUnboundEntitlementRefundWithoutGuessingRevocation();
  await settlesOnlyAbortedOrExpiredUnpaidOrders();
  await doesNotRevokeRepurchaseWhenOldRefundReplays();
  await keepsPaymentModeRecoveryIsolated();
  await fencesRecoveryLeases();
  await preservesAdminGrantAndManualRevoke();
  await preservesImmutableEntitlementGrantSnapshot();
  await keepsLedgersAndNotificationsBoundToGrantingOrder();
  await ledgersDoNotReportActiveWhenEffectiveEntitlementIsNotAlive();
  await routesLegacyUnsnapshottedCompletionToReview();
  await requiresRealPostgresConcurrencyUnlessExplicitlyWaived();
  await concurrentClaimsReturnOneLease();
  await concurrentConfirmReplayAndCancelSettlesOneCoherentState();
  await concurrentOldRefundReplayDoesNotOverrideNewPaymentConfirmation();
  await concurrentAdminRevokeAndConfirmationDoNotUndoManualOverride();
  await preservesManualReactivationViaAdminUpdateAgainstOldRefund();
  await repeatedPaymentDoneDoesNotCompletePendingRefundJob();

  if (findings.length) {
    for (const finding of findings) console.error(`FINDING: ${finding}`);
    process.exitCode = 1;
  } else {
    console.log(
      `PASS: payment recovery fixture (${fixture.kind}), recovery RPC contracts, fixed payment edge cases, lease fencing, admin override safeguards`
    );
  }
} finally {
  await fixture.close();
}

async function verifiesRecoverySchemaContract() {
  assert.equal(await relationExists("payment_entitlement_grants"), true);
  assert.equal(await columnExists("product_entitlements", "payment_order_id"), true);
  assert.equal(await columnExists("orders", "payment_mode"), true);
  assert.equal(await columnExists("orders", "confirmation_state"), true);
  assert.equal(await columnExists("orders", "snapshot_captured"), true);
  assert.equal(await columnExists("orders", "access_period_days_at_purchase"), true);
  assert.equal(await columnExists("payment_entitlement_grants", "status"), true);
  assert.equal(await columnExists("payment_entitlement_grants", "revoked_reason"), true);
  const jobTable = await recoveryJobTable();
  assert.ok(jobTable, "recovery jobs table with operation/lease columns must exist");
  for (const column of [
    "status",
    "operation",
    "confirmation_key",
    "idempotency_key",
    "allow_confirm",
    "lease_token",
    "lease_until",
    "attempt_count",
    "next_attempt_at",
    "last_error_code",
  ]) {
    assert.equal(await columnExists(jobTable, column), true, `${jobTable}.${column} must exist`);
  }
  for (const name of [
    "prepare_toss_confirmation_server",
    "claim_toss_payment_recovery",
    "finish_toss_payment_recovery",
    "bind_toss_order_mode_server",
    "settle_toss_unpaid_order_server",
    "ensure_toss_reconciliation_server",
  ]) {
    assert.equal(await functionExists(name), true, `${name} must be installed`);
  }
}

async function rejectsBrowserRolesForServerRecoveryRpcs() {
  await resetState();
  const order = await createPendingOrder("sns-monetization-feedback");
  await bindMode(order.order_uid, TOSS_TEST_MODE);
  await assert.rejects(
    () => prepare(order.order_uid, "browser-key", TOSS_TEST_MODE, "authenticated"),
    /service role required|permission denied/i
  );
  await assert.rejects(
    () => rows("select * from claim_toss_payment_recovery($1,$2)", [TOSS_TEST_MODE, 1]),
    /service role required|permission denied/i
  );
}

async function persistsPreparedApprovalBeforeFulfillment() {
  await resetState();
  const order = await createPendingOrder("sns-monetization-feedback");
  await bindMode(order.order_uid, TOSS_TEST_MODE);
  await prepare(order.order_uid, "prepared-key-1", TOSS_TEST_MODE);

  const [stored] = await rows(
    "select status, payment_key, payment_mode, confirmation_state, approved_at is not null as has_approved_at from orders where order_uid=$1",
    [order.order_uid]
  );
  assert.equal(stored.status, "pending", "prepare must not fulfill or grant access");
  assert.equal(stored.payment_key, null, "prepare must not persist provider key before provider verification");
  assert.equal(stored.payment_mode, TOSS_TEST_MODE);
  assert.equal(stored.confirmation_state, "confirming");
  assert.equal(stored.has_approved_at, false, "prepare must not stamp approval time before provider verification");
  const jobTable = await recoveryJobTable();
  const [job] = await rows(
    `select confirmation_key, operation, status, allow_confirm, lease_until > now() as leased
       from ${jobTable}
      where order_id=(select id from orders where order_uid=$1)
      order by created_at desc limit 1`,
    [order.order_uid]
  );
  assert.equal(job.confirmation_key, "prepared-key-1");
  assert.equal(job.operation, "confirmation");
  assert.equal(job.status, "processing");
  assert.equal(job.allow_confirm, true);
  assert.equal(job.leased, true);

  const [repeat] = await prepare(order.order_uid, "prepared-key-1", TOSS_TEST_MODE);
  assert.equal(repeat.lease_token, null);
  assert.equal(repeat.can_confirm, false);
  assert.equal((await countRows("product_entitlements", "user_id=$1", [ids.buyer])), 0);
}

async function rejectsReplayWithDifferentPaymentKey() {
  await resetState();
  const order = await createPendingOrder("sns-monetization-feedback");
  await bindMode(order.order_uid, TOSS_TEST_MODE);
  await prepare(order.order_uid, "replay-key-original", TOSS_TEST_MODE);
  await assert.rejects(
    () => prepare(order.order_uid, "replay-key-other", TOSS_TEST_MODE),
    /payment key|another payment|mismatch|conflict/i
  );
}

async function snapshotsNewRpcOrdersBeforeConfirmation() {
  await resetState();
  const order = await createPendingOrder("sns-monetization-feedback");
  const [stored] = await rows(
    "select snapshot_captured, access_period_days_at_purchase from orders where order_uid=$1",
    [order.order_uid]
  );
  assert.equal(stored.snapshot_captured, true);
  assert.equal(stored.access_period_days_at_purchase, 365);
}

async function rejectsUnsupportedPaymentModes() {
  await resetState();
  const order = await createPendingOrder("sns-monetization-feedback");
  await assert.rejects(
    () => bindMode(order.order_uid, "checkout"),
    /mode|payment_mode|toss_test|toss_live|invalid/i
  );
  await assert.rejects(
    () => bindMode(order.order_uid, "webhook"),
    /mode|payment_mode|toss_test|toss_live|invalid/i
  );
}

async function recordsVerifiedProviderStateForReconciliation() {
  await resetState();
  const order = await createPendingOrder("sns-monetization-feedback");
  await bindMode(order.order_uid, TOSS_TEST_MODE);
  const [changed] = await rows(
    "select ensure_toss_reconciliation_server($1,$2,$3,$4,$5,$6,now()) as changed",
    [ids.buyer, order.order_uid, "verified-done-key", order.amount, TOSS_TEST_MODE, "DONE"]
  );
  assert.equal(changed.changed, true);
  const [stored] = await rows(
    "select payment_key, approved_at is not null as has_approved_at, confirmation_state from orders where order_uid=$1",
    [order.order_uid]
  );
  assert.equal(stored.payment_key, "verified-done-key");
  assert.equal(stored.has_approved_at, true);
  assert.equal(stored.confirmation_state, "unknown");
  const [job] = await rows(
    `select operation, status, confirmation_key, allow_confirm
       from payment_recovery_jobs
      where order_id=(select id from orders where order_uid=$1)`,
    [order.order_uid]
  );
  assert.deepEqual(job, {
    operation: "reconcile",
    status: "ready",
    confirmation_key: "verified-done-key",
    allow_confirm: false,
  });
}

async function blocksFreshChargeWhenApprovedOrderWasFailed() {
  await resetState();
  const order = await createPendingOrder("sns-monetization-feedback");
  await bindMode(order.order_uid, TOSS_TEST_MODE);
  await prepare(order.order_uid, "failed-approved-key", TOSS_TEST_MODE);
  await rows("update orders set payment_key='failed-approved-key', approved_at=now() where order_uid=$1", [
    order.order_uid,
  ]);
  await rows("alter table orders disable trigger guard_uncertain_payment_transition");
  try {
    await rows(
      "update orders set status='failed', created_at=now()-interval '31 minutes', updated_at=now()-interval '31 minutes' where order_uid=$1",
      [order.order_uid]
    );
  } finally {
    await rows("alter table orders enable trigger guard_uncertain_payment_transition");
  }

  await assert.rejects(
    () => asBuyer(() => rows("select * from create_toss_payment_order('sns-monetization-feedback')")),
    /approval|confirmation|recovery|pending|already/i
  );
  assert.equal(await countRows("orders", "user_id=$1 and source='payment' and status='pending'", [ids.buyer]), 0);
  const [stored] = await rows("select status, payment_key from orders where order_uid=$1", [order.order_uid]);
  assert.equal(stored.status, "failed");
  assert.equal(stored.payment_key, "failed-approved-key");
}

async function preventsAttemptedOrdersFromBeingDemotedToFailed() {
  await resetState();
  const direct = await createPendingOrder("sns-monetization-feedback");
  await bindMode(direct.order_uid, TOSS_TEST_MODE);
  await prepare(direct.order_uid, "direct-demote-key", TOSS_TEST_MODE);
  await assert.rejects(
    () => rows("update orders set status='failed' where order_uid=$1", [direct.order_uid]),
    /payment recovery pending|cannot fail|55000/i
  );

  await resetState();
  const expiring = await createPendingOrder("sns-monetization-feedback");
  await bindMode(expiring.order_uid, TOSS_TEST_MODE);
  await prepare(expiring.order_uid, "expire-demote-key", TOSS_TEST_MODE);
  await rows("update orders set created_at=now()-interval '90 minutes' where order_uid=$1", [
    expiring.order_uid,
  ]);
  const [expired] = await rows("select expire_stale_toss_payment_orders(30) as changed");
  assert.equal(expired.changed, 0, "expiry worker must not demote attempted payment orders");
  const [expiringOrder] = await rows("select status from orders where order_uid=$1", [expiring.order_uid]);
  assert.equal(expiringOrder.status, "pending");

  await resetState();
  const rpc = await createPendingOrder("sns-monetization-feedback");
  await bindMode(rpc.order_uid, TOSS_TEST_MODE);
  await prepare(rpc.order_uid, "rpc-demote-key", TOSS_TEST_MODE);
  const [failed] = await asBuyer(() => rows("select fail_toss_payment_order($1) as changed", [rpc.order_uid]));
  assert.equal(failed.changed, false, "member fail RPC must not demote attempted payment orders");
  const [rpcOrder] = await rows("select status from orders where order_uid=$1", [rpc.order_uid]);
  assert.equal(rpcOrder.status, "pending");
}

async function blocksWithdrawalWhilePaymentRecoveryOrRefundIsOpen() {
  await resetState();
  const pending = await createPendingOrder("sns-monetization-feedback");
  await assert.rejects(
    () =>
      rows("insert into account_withdrawals(user_id, provider, status) values($1,'email','processing')", [
        ids.buyer,
      ]),
    /payment_in_progress/i
  );
  await rows("delete from orders where order_uid=$1", [pending.order_uid]);

  const legacy = await createPendingOrder("sns-monetization-feedback");
  await bindMode(legacy.order_uid, TOSS_TEST_MODE);
  await prepare(legacy.order_uid, "failed-legacy-unknown-key", TOSS_TEST_MODE);
  await rows("alter table orders disable trigger guard_uncertain_payment_transition");
  try {
    await rows(
      "update orders set status='failed', confirmation_state='unknown' where order_uid=$1",
      [legacy.order_uid]
    );
  } finally {
    await rows("alter table orders enable trigger guard_uncertain_payment_transition");
  }
  await assert.rejects(
    () =>
      rows("insert into account_withdrawals(user_id, provider, status) values($1,'email','processing')", [
        ids.buyer,
      ]),
    /payment_in_progress/i
  );
  await rows("delete from payment_recovery_jobs");
  await rows("delete from orders where order_uid=$1", [legacy.order_uid]);

  const refunding = await createPendingOrder("sns-monetization-feedback");
  await approve(refunding, "withdrawal-open-refund-key");
  const [orderRow] = await rows("select id from orders where order_uid=$1", [refunding.order_uid]);
  await rows(
    `insert into payment_refunds(order_id, refund_uid, amount, reason, status, requested_by, idempotency_key)
     values($1,'RFD-WITHDRAWAL-BLOCK',$2,'withdrawal guard','processing',$3,'withdrawal-refund-idem')`,
    [orderRow.id, refunding.amount, ids.owner]
  );
  await assert.rejects(
    () =>
      rows("insert into account_withdrawals(user_id, provider, status) values($1,'email','processing')", [
        ids.buyer,
      ]),
    /refund_in_progress/i
  );
}

async function repeatedPaymentDoneDoesNotCompletePendingRefundJob() {
  await resetState();
  const order = await createPendingOrder("sns-monetization-feedback");
  await approve(order, "refund-awaiting-cancel-key");
  const [orderRow] = await rows("select id from orders where order_uid=$1", [order.order_uid]);
  await rows(
    "select * from begin_toss_refund_server($1,$2,'RFD-AWAITING-CANCEL','refund-awaiting-cancel-idem','awaiting cancel regression')",
    [orderRow.id, ids.owner]
  );

  await rows("select * from complete_toss_payment_server($1,$2,$3,$4,now())", [
    ids.buyer,
    order.order_uid,
    "refund-awaiting-cancel-key",
    order.amount,
  ]);
  const [jobBeforeCancel] = await rows(
    "select operation, status from payment_recovery_jobs where order_id=$1",
    [orderRow.id]
  );
  assert.equal(jobBeforeCancel.operation, "refund");
  assert.match(jobBeforeCancel.status, /ready|processing/);
  const [refundBeforeCancel] = await rows(
    "select status from payment_refunds where order_id=$1 and refund_uid='RFD-AWAITING-CANCEL'",
    [orderRow.id]
  );
  assert.equal(refundBeforeCancel.status, "processing");

  const [settled] = await rows(
    "select * from complete_toss_refund_server($1,$2,$3,now(),'refund-awaiting-cancel-txn','RFD-AWAITING-CANCEL',$4,'awaiting cancel regression')",
    [order.order_uid, "refund-awaiting-cancel-key", order.amount, ids.owner]
  );
  assert.equal(settled.refund_status, "succeeded");
  const [jobAfterCancel] = await rows(
    "select operation, status from payment_recovery_jobs where order_id=$1",
    [orderRow.id]
  );
  assert.equal(jobAfterCancel.operation, "refund");
  assert.equal(jobAfterCancel.status, "done");
  const [refundAfterCancel] = await rows(
    "select status from payment_refunds where order_id=$1 and refund_uid='RFD-AWAITING-CANCEL'",
    [orderRow.id]
  );
  assert.equal(refundAfterCancel.status, "succeeded");
}

async function settlesNullKeyCancellationAfterServerVerification() {
  await resetState();
  const order = await createPendingOrder("sns-monetization-feedback");
  await bindMode(order.order_uid, TOSS_TEST_MODE);
  await refund(order, "late-cancel-key", "late-cancel-txn");

  const [stored] = await rows(
    "select status, payment_key, payment_mode from orders where order_uid=$1",
    [order.order_uid]
  );
  assert.equal(stored.status, "refunded");
  assert.equal(stored.payment_key, "late-cancel-key");
  assert.equal(stored.payment_mode, TOSS_TEST_MODE);
  assert.equal(await countRows("payment_refunds", "order_id=(select id from orders where order_uid=$1)", [order.order_uid]), 1);
}

async function ignoresPartialFailedRefundWhenFullCancelArrives() {
  await resetState();
  const order = await createPendingOrder("sns-monetization-feedback");
  await approve(order, "partial-then-full-key");
  await rows(
    `insert into payment_refunds(order_id, refund_uid, amount, reason, status, requested_by, idempotency_key, error_code)
     values((select id from orders where order_uid=$1), 'partial-failed-refund', 1000,
       'partial console cancellation', 'failed', null, 'partial-failed-idempotency',
       'PARTIAL_CANCELLATION_UNSUPPORTED')`,
    [order.order_uid]
  );
  await refund(order, "partial-then-full-key", "full-cancel-after-partial");
  const refundRows = await rows(
    "select refund_uid, amount, status, error_code from payment_refunds where order_id=(select id from orders where order_uid=$1) order by amount, refund_uid",
    [order.order_uid]
  );
  assert.equal(refundRows.some((row) => row.refund_uid === "partial-failed-refund" && row.amount === 1000 && row.status === "failed"), true);
  assert.equal(refundRows.some((row) => row.refund_uid !== "partial-failed-refund" && row.amount === order.amount && row.status === "succeeded"), true);
}

async function reviewsLegacyUnboundEntitlementRefundWithoutGuessingRevocation() {
  await resetState();
  await rows(
    `insert into orders(user_id, product_id, order_uid, amount, source, status, payment_key, payment_mode,
      approved_at, refund_policy_version, refund_policy_agreed_at)
     values($1,$2,'LEGACY-UNBOUND-REFUND',1200000,'payment','paid','legacy-unbound-key',$3,
      now(),'2026-07-29',now())`,
    [ids.buyer, ids.feedbackProduct, TOSS_TEST_MODE]
  );
  await rows(
    `insert into product_entitlements(user_id, product_id, source, status, granted_at, expires_at, payment_order_id)
     values($1,$2,'payment','active',now(),now()+interval '365 days',null)`,
    [ids.buyer, ids.feedbackProduct]
  );

  const [settled] = await rows(
    "select * from complete_toss_refund_server('LEGACY-UNBOUND-REFUND','legacy-unbound-key',1200000,now(),'legacy-unbound-cancel',null,$1,'legacy full cancel')",
    [ids.owner]
  );
  assert.equal(settled.refund_status, "review");
  const [order] = await rows(
    "select status from orders where order_uid='LEGACY-UNBOUND-REFUND'"
  );
  assert.equal(order.status, "refunded");
  const [entitlement] = await rows(
    "select status, payment_order_id from product_entitlements where user_id=$1 and product_id=$2",
    [ids.buyer, ids.feedbackProduct]
  );
  assert.equal(entitlement.status, "active");
  assert.equal(entitlement.payment_order_id, null);
  const [job] = await rows(
    `select status, last_error_code from payment_recovery_jobs
      where order_id=(select id from orders where order_uid='LEGACY-UNBOUND-REFUND')`
  );
  assert.equal(job.status, "review");
  assert.equal(job.last_error_code, "LEGACY_ENTITLEMENT_LINK_REQUIRES_REVIEW");

  const [repeat] = await rows(
    "select * from complete_toss_refund_server('LEGACY-UNBOUND-REFUND','legacy-unbound-key',1200000,now(),'legacy-unbound-cancel',null,$1,'legacy full cancel replay')",
    [ids.owner]
  );
  assert.equal(repeat.refund_status, "review");
  const [repeatJob] = await rows(
    `select status, last_error_code from payment_recovery_jobs
      where order_id=(select id from orders where order_uid='LEGACY-UNBOUND-REFUND')`
  );
  assert.equal(repeatJob.status, "review");
  assert.equal(repeatJob.last_error_code, "LEGACY_ENTITLEMENT_LINK_REQUIRES_REVIEW");
}

async function settlesOnlyAbortedOrExpiredUnpaidOrders() {
  await resetState();
  const aborted = await createPendingOrder("sns-monetization-feedback");
  await bindMode(aborted.order_uid, TOSS_TEST_MODE);
  await rows("select * from settle_toss_unpaid_order_server($1,$2,$3,$4)", [
    aborted.order_uid,
    "aborted-unpaid-key",
    "ABORTED",
    TOSS_TEST_MODE,
  ]);
  const [abortedOrder] = await rows("select status from orders where order_uid=$1", [
    aborted.order_uid,
  ]);
  assert.match(abortedOrder.status, /failed|canceled/);

  const expired = await createPendingOrder("sns-monetization-feedback");
  await bindMode(expired.order_uid, TOSS_TEST_MODE);
  await rows("select * from settle_toss_unpaid_order_server($1,$2,$3,$4)", [
    expired.order_uid,
    "expired-unpaid-key",
    "EXPIRED",
    TOSS_TEST_MODE,
  ]);
  const [expiredOrder] = await rows("select status from orders where order_uid=$1", [
    expired.order_uid,
  ]);
  assert.match(expiredOrder.status, /failed|canceled/);

  const canceled = await createPendingOrder("sns-monetization-feedback");
  await bindMode(canceled.order_uid, TOSS_TEST_MODE);
  await assert.rejects(
    () => rows("select * from settle_toss_unpaid_order_server($1,$2,$3,$4)", [
      canceled.order_uid,
      "must-not-bind",
      "CANCELED",
      TOSS_TEST_MODE,
    ]),
    /status|aborted|expired|invalid/i
  );
}

async function doesNotRevokeRepurchaseWhenOldRefundReplays() {
  await resetState();
  const first = await createPendingOrder("sns-monetization-feedback");
  await approve(first, "old-refund-first-key");
  await refund(first, "old-refund-first-key", "old-refund-txn-1");

  const second = await createPendingOrder("sns-monetization-feedback");
  await approve(second, "old-refund-second-key");
  await refund(first, "old-refund-first-key", "old-refund-txn-1");

  const [entitlement] = await rows(
    `select e.status, o.order_uid as granting_order_uid
       from product_entitlements e
       join orders o on o.id = e.payment_order_id
      where e.user_id=$1 and e.product_id=$2`,
    [ids.buyer, ids.feedbackProduct]
  );
  assert.equal(entitlement.status, "active");
  assert.equal(entitlement.granting_order_uid, second.order_uid);
}

async function keepsPaymentModeRecoveryIsolated() {
  await resetState();
  const checkoutOrder = await createPendingOrder("sns-monetization-feedback");
  const webhookOrder = await createPendingOrderFor(ids.other, "sns-monetization-ultra");
  await bindMode(checkoutOrder.order_uid, TOSS_TEST_MODE);
  await bindMode(webhookOrder.order_uid, TOSS_LIVE_MODE, ids.other);
  await prepare(checkoutOrder.order_uid, "mode-test-key", TOSS_TEST_MODE);
  await prepare(webhookOrder.order_uid, "mode-live-key", TOSS_LIVE_MODE, "service_role", ids.other);

  await expireLeases();
  const testClaims = await rows("select * from claim_toss_payment_recovery($1,$2)", [TOSS_TEST_MODE, 10]);
  const liveClaims = await rows("select * from claim_toss_payment_recovery($1,$2)", [TOSS_LIVE_MODE, 10]);
  assert.deepEqual(testClaims.map((row) => row.order_uid), [checkoutOrder.order_uid]);
  assert.deepEqual(liveClaims.map((row) => row.order_uid), [webhookOrder.order_uid]);
}

async function fencesRecoveryLeases() {
  await resetState();
  const order = await createPendingOrder("sns-monetization-feedback");
  await bindMode(order.order_uid, TOSS_TEST_MODE);
  const [prepared] = await prepare(order.order_uid, "lease-key", TOSS_TEST_MODE);
  assert.ok(prepared?.lease_token, "prepare returns a lease token");
  assert.equal(prepared?.lease_seconds ?? 120, 120, "prepare lease is 120 seconds");
  assert.deepEqual(await rows("select * from claim_toss_payment_recovery($1,$2)", [TOSS_TEST_MODE, 1]), []);
  await expireLeases();
  const [claim] = await rows("select * from claim_toss_payment_recovery($1,$2)", [TOSS_TEST_MODE, 1]);
  assert.ok(claim?.lease_token, "claim returns a lease_token");

  const [wrongToken] = await rows("select * from finish_toss_payment_recovery($1,$2,$3,$4)", [
      order.order_uid,
      "00000000-0000-0000-0000-000000000000",
      null,
      false,
    ]);
  assert.equal(Object.values(wrongToken)[0], false, "wrong lease token returns false");
  await rows("select * from finish_toss_payment_recovery($1,$2,$3,$4)", [
    order.order_uid,
    claim.lease_token,
    "TRANSIENT_PROVIDER_ERROR",
    true,
  ]);

  const [stored] = await rows(
    "select confirmation_state from orders where order_uid=$1",
    [order.order_uid]
  );
  assert.match(stored.confirmation_state, /review|failed|retry/i);
}

async function preservesAdminGrantAndManualRevoke() {
  await resetState();
  const order = await createPendingOrder("sns-monetization-feedback");
  await approve(order, "admin-protection-key");
  const [entitlement] = await rows(
    "select id from product_entitlements where user_id=$1 and product_id=$2",
    [ids.buyer, ids.feedbackProduct]
  );

  await asOwner(() =>
    rows("select admin_update_product_entitlement($1,'revoked',null)", [entitlement.id])
  );
  await assert.rejects(
    () => rows("select * from complete_toss_payment_server($1,$2,$3,$4,now())", [
      ids.buyer,
      order.order_uid,
      "admin-protection-key",
      order.amount,
    ]),
    /grant revoked|review|required|expired/i
  );
  const [afterManualRevoke] = await rows("select status from product_entitlements where id=$1", [
    entitlement.id,
  ]);
  assert.equal(afterManualRevoke.status, "revoked", "payment replay must not undo an admin/manual revoke");

  await asOwner(() =>
    rows("select admin_grant_product_entitlement($1,$2,now()+interval '30 days')", [
      ids.buyer,
      ids.feedbackProduct,
    ])
  );
  await refund(order, "admin-protection-key", "admin-protection-refund");
  const [afterAdminGrant] = await rows("select source, status from product_entitlements where id=$1", [
    entitlement.id,
  ]);
  assert.deepEqual(afterAdminGrant, { source: "admin_grant", status: "active" });
}

async function preservesManualReactivationViaAdminUpdateAgainstOldRefund() {
  await resetState();
  const order = await createPendingOrder("sns-monetization-feedback");
  await approve(order, "admin-update-reactivation-key");
  const [entitlement] = await rows(
    "select id from product_entitlements where user_id=$1 and product_id=$2",
    [ids.buyer, ids.feedbackProduct]
  );

  await asOwner(() =>
    rows("select admin_update_product_entitlement($1,'revoked',null)", [entitlement.id])
  );
  const [grantAfterRevoke] = await rows(
    "select status, revoked_reason from payment_entitlement_grants where order_id=(select id from orders where order_uid=$1)",
    [order.order_uid]
  );
  assert.equal(grantAfterRevoke.status, "revoked");
  assert.match(grantAfterRevoke.revoked_reason, /admin|manual|entitlement/i);

  await asOwner(() =>
    rows("select admin_update_product_entitlement($1,'active',now()+interval '30 days')", [entitlement.id])
  );
  const [restored] = await rows(
    "select source, status, payment_order_id from product_entitlements where id=$1",
    [entitlement.id]
  );
  assert.deepEqual(restored, { source: "admin_grant", status: "active", payment_order_id: null });
  const [grantAfterRestore] = await rows(
    "select status, revoked_reason from payment_entitlement_grants where order_id=(select id from orders where order_uid=$1)",
    [order.order_uid]
  );
  assert.equal(grantAfterRestore.status, "revoked", "manual restore must not reactivate the immutable payment grant");
  assert.match(grantAfterRestore.revoked_reason, /admin|manual|entitlement/i);

  await refund(order, "admin-update-reactivation-key", "admin-update-reactivation-refund");
  const [afterRefund] = await rows(
    "select source, status, payment_order_id from product_entitlements where id=$1",
    [entitlement.id]
  );
  assert.deepEqual(afterRefund, { source: "admin_grant", status: "active", payment_order_id: null });
  const [grantAfterRefund] = await rows(
    "select status, revoked_reason from payment_entitlement_grants where order_id=(select id from orders where order_uid=$1)",
    [order.order_uid]
  );
  assert.equal(grantAfterRefund.status, "revoked");
  assert.match(grantAfterRefund.revoked_reason, /admin|manual|entitlement/i);
}

async function preservesImmutableEntitlementGrantSnapshot() {
  await resetState();
  const order = await createPendingOrder("sns-monetization-feedback");
  await approve(order, "snapshot-key");

  const [grant] = await rows(
    "select order_id, status, revoked_reason from payment_entitlement_grants where order_id=(select id from orders where order_uid=$1)",
    [order.order_uid]
  );
  assert.equal(grant.status, "active");
  assert.equal(grant.revoked_reason, null);

  await rows("update product_entitlements set status='revoked' where payment_order_id=$1", [grant.order_id]);
  const [after] = await rows(
    "select status, revoked_reason from payment_entitlement_grants where order_id=$1",
    [grant.order_id]
  );
  assert.equal(after.status, "revoked");
  assert.match(after.revoked_reason, /admin|manual|external|entitlement/i);
}

async function keepsLedgersAndNotificationsBoundToGrantingOrder() {
  await resetState();
  const first = await createPendingOrder("sns-monetization-feedback");
  await approve(first, "ledger-first-key");
  await refund(first, "ledger-first-key", "ledger-first-refund");
  const second = await createPendingOrder("sns-monetization-feedback");
  await approve(second, "ledger-second-key");
  await refund(first, "ledger-first-key", "ledger-first-refund");

  await fixture.setActor(ids.buyer, "authenticated");
  const memberRows = await rows(
    "select order_uid, payment_status, entitlement_status from get_my_order_ledger() where order_uid in ($1,$2) order by order_uid",
    [first.order_uid, second.order_uid]
  );
  assert.deepEqual(
    memberRows.map((row) => [row.order_uid, row.payment_status, row.entitlement_status]),
    [
      [first.order_uid, "refunded", "revoked"],
      [second.order_uid, "paid", "active"],
    ].sort((left, right) => left[0].localeCompare(right[0]))
  );

  await fixture.setActor(ids.owner, "authenticated");
  const adminRows = await rows(
    "select order_uid, payment_status, entitlement_status from admin_order_ledger_base(null,'all','all',null,false) where order_uid in ($1,$2) order by order_uid",
    [first.order_uid, second.order_uid]
  );
  assert.deepEqual(
    adminRows.map((row) => [row.order_uid, row.payment_status, row.entitlement_status]),
    [
      [first.order_uid, "refunded", "revoked"],
      [second.order_uid, "paid", "active"],
    ].sort((left, right) => left[0].localeCompare(right[0]))
  );

  await fixture.setActor("", "service_role");
  assert.deepEqual(await rows("select * from claim_payment_notification($1)", [first.order_uid]), []);
  const [claim] = await rows("select * from claim_payment_notification($1)", [second.order_uid]);
  assert.equal(claim.order_uid, second.order_uid);
  const [started] = await rows("select begin_payment_notification_send($1,$2,'PAYMENT') as started", [
    claim.order_id,
    claim.attempt_id,
  ]);
  assert.equal(started.started, true);
}

async function ledgersDoNotReportActiveWhenEffectiveEntitlementIsNotAlive() {
  await resetState();
  const order = await createPendingOrder("sns-monetization-feedback");
  await approve(order, "grant-active-entitlement-revoked-key");
  await rows("alter table product_entitlements disable trigger preserve_payment_entitlement_override");
  await rows(
    "update product_entitlements set status='revoked', updated_at=now() where payment_order_id=(select id from orders where order_uid=$1)",
    [order.order_uid]
  );
  await rows("alter table product_entitlements enable trigger preserve_payment_entitlement_override");
  await rows(
    "update payment_entitlement_grants set status='active', revoked_reason=null where order_id=(select id from orders where order_uid=$1)",
    [order.order_uid]
  );

  await fixture.setActor(ids.buyer, "authenticated");
  const [memberRow] = await rows(
    "select entitlement_status from get_my_order_ledger() where order_uid=$1",
    [order.order_uid]
  );
  if (memberRow.entitlement_status === "active") {
    findings.push("get_my_order_ledger reports active when payment_entitlement_grants is active but the effective product_entitlements row is revoked");
  }

  await fixture.setActor(ids.owner, "authenticated");
  const [adminRow] = await rows(
    "select entitlement_status from admin_order_ledger_base(null,'all','all',null,false) where order_uid=$1",
    [order.order_uid]
  );
  if (adminRow.entitlement_status === "active") {
    findings.push("admin_order_ledger_base reports active when payment_entitlement_grants is active but the effective product_entitlements row is revoked");
  }
}

async function routesLegacyUnsnapshottedCompletionToReview() {
  await resetState();
  await seedLegacyUnsnapshottedOrder("LEGACY-DIRECT-ERROR");
  await bindMode("LEGACY-DIRECT-ERROR", TOSS_TEST_MODE);
  await rows("update orders set payment_key='legacy-direct-key', approved_at=now() where order_uid='LEGACY-DIRECT-ERROR'");
  await assert.rejects(
    () => rows("select * from complete_toss_payment_server($1,'LEGACY-DIRECT-ERROR','legacy-direct-key',1200000,now())", [
      ids.buyer,
    ]),
    /snapshot|review|manual|legacy/i
  );
  assert.equal(
    await countRows("payment_recovery_jobs", "order_id=(select id from orders where order_uid=$1)", [
      "LEGACY-DIRECT-ERROR",
    ]),
    0,
    "direct SQL exception rolls back; review persistence belongs to reconciliation workflow"
  );

  await resetState();
  await seedLegacyUnsnapshottedOrder("LEGACY-ENSURED-REVIEW");
  await bindMode("LEGACY-ENSURED-REVIEW", TOSS_TEST_MODE);
  const [ensured] = await rows(
    "select ensure_toss_reconciliation_server($1,$2,$3,$4,$5,$6,now()) as changed",
    [ids.buyer, "LEGACY-ENSURED-REVIEW", "legacy-ensured-key", 1200000, TOSS_TEST_MODE, "DONE"]
  );
  assert.equal(ensured.changed, true);
  await assert.rejects(
    () => rows("select * from complete_toss_payment_server($1,'LEGACY-ENSURED-REVIEW','legacy-ensured-key',1200000,now())", [
      ids.buyer,
    ]),
    /snapshot|review|manual|legacy/i
  );
  const [claim] = await rows("select * from claim_toss_payment_recovery($1,$2)", [TOSS_TEST_MODE, 1]);
  assert.equal(claim.order_uid, "LEGACY-ENSURED-REVIEW");
  assert.equal(claim.operation, "reconcile");
  assert.equal(claim.can_confirm, false);
  const [finished] = await rows("select finish_toss_payment_recovery($1,$2,$3,$4) as finished", [
    "LEGACY-ENSURED-REVIEW",
    claim.lease_token,
    "SQL55000_LEGACY_SNAPSHOT_REVIEW",
    true,
  ]);
  assert.equal(finished.finished, true);
  const [job] = await rows(
    `select status, last_error_code
       from payment_recovery_jobs
      where order_id=(select id from orders where order_uid='LEGACY-ENSURED-REVIEW')`
  );
  assert.equal(job.status, "review");
  assert.match(job.last_error_code, /SQL55000|LEGACY|SNAPSHOT|REVIEW/i);
  const [order] = await rows(
    "select confirmation_state from orders where order_uid='LEGACY-ENSURED-REVIEW'"
  );
  assert.equal(order.confirmation_state, "review");
}

async function seedLegacyUnsnapshottedOrder(orderUid) {
  await rows("alter table orders disable trigger capture_payment_access_snapshot");
  await rows(
    `insert into orders(user_id, product_id, order_uid, amount, source, status, refund_policy_version, refund_policy_agreed_at)
     values($1,$2,$3,1200000,'payment','pending','2026-07-29',now())`,
    [ids.buyer, ids.feedbackProduct, orderUid]
  );
  await rows("alter table orders enable trigger capture_payment_access_snapshot");
}

async function requiresRealPostgresConcurrencyUnlessExplicitlyWaived() {
  if (!fixture.supportsConcurrentSessions) {
    if (process.env.PAYMENT_DB_ALLOW_SERIAL_ONLY === "1") {
      console.log(
        "SKIP: real PostgreSQL multi-session concurrency unavailable; PAYMENT_DB_ALLOW_SERIAL_ONLY=1 allowed serial-only validation."
      );
      return;
    }
    throw new Error(
      "real PostgreSQL multi-session concurrency unavailable; set PAYMENT_DB_ALLOW_SERIAL_ONLY=1 only for explicit PGlite serial-only transition checks"
    );
  }
  assert.equal(typeof rowsAs, "function", "concurrent fixture must expose actor-scoped sessions");
}

async function concurrentClaimsReturnOneLease() {
  await resetState();
  const order = await createPendingOrder("sns-monetization-feedback");
  await bindMode(order.order_uid, TOSS_TEST_MODE);
  await prepare(order.order_uid, "concurrent-claim-key", TOSS_TEST_MODE);
  await expireLeases();

  const results = await Promise.all([
    rowsAs("", "service_role", "select * from claim_toss_payment_recovery($1,$2)", [TOSS_TEST_MODE, 1]),
    rowsAs("", "service_role", "select * from claim_toss_payment_recovery($1,$2)", [TOSS_TEST_MODE, 1]),
  ]);
  const claims = results.flat();
  assert.equal(claims.length, 1, "only one worker may claim the expired recovery lease");
  assert.equal(claims[0].order_uid, order.order_uid);
  assert.ok(claims[0].lease_token);
}

async function concurrentConfirmReplayAndCancelSettlesOneCoherentState() {
  await resetState();
  const order = await createPendingOrder("sns-monetization-feedback");
  await bindMode(order.order_uid, TOSS_TEST_MODE);
  await prepare(order.order_uid, "same-order-race-key", TOSS_TEST_MODE);
  await rows("update orders set payment_key='same-order-race-key', approved_at=now() where order_uid=$1", [
    order.order_uid,
  ]);

  const attempts = await Promise.allSettled([
    rowsAs("", "service_role", "select * from complete_toss_payment_server($1,$2,$3,$4,now())", [
      ids.buyer,
      order.order_uid,
      "same-order-race-key",
      order.amount,
    ]),
    rowsAs("", "service_role", "select * from complete_toss_payment_server($1,$2,$3,$4,now())", [
      ids.buyer,
      order.order_uid,
      "same-order-race-key",
      order.amount,
    ]),
    rowsAs("", "service_role", "select * from complete_toss_refund_server($1,$2,$3,now(),$4,null,$5,'same order race cancel')", [
      order.order_uid,
      "same-order-race-key",
      order.amount,
      "same-order-race-cancel",
      ids.owner,
    ]),
  ]);
  assertExpectedConcurrentRejections(attempts);
  assert.equal(attempts[2].status, "fulfilled", "concurrent cancel attempt must fulfill");
  const [summary] = await rows(
    `select o.status, o.confirmation_state,
      (select count(*)::int from payment_entitlement_grants g where g.order_id=o.id) as grant_count,
      (select count(*)::int from payment_refunds r where r.order_id=o.id and r.status='succeeded') as succeeded_refunds,
      exists (
        select 1 from product_entitlements e
        where e.payment_order_id=o.id and e.status='active' and (e.expires_at is null or e.expires_at > now())
      ) as has_active_payment_entitlement
     from orders o where o.order_uid=$1`,
    [order.order_uid]
  );
  assert.equal(summary.status, "refunded");
  assert.equal(summary.grant_count <= 1, true, "confirm replay must not create duplicate grants");
  assert.equal(summary.succeeded_refunds, 1, "cancel must settle exactly one succeeded refund");
  assert.equal(summary.has_active_payment_entitlement, false, "cancel must leave no active payment entitlement");
}

async function concurrentOldRefundReplayDoesNotOverrideNewPaymentConfirmation() {
  await resetState();
  const first = await createPendingOrder("sns-monetization-feedback");
  await approve(first, "race-first-key");
  await refund(first, "race-first-key", "race-first-refund");
  const second = await createPendingOrder("sns-monetization-feedback");
  await bindMode(second.order_uid, TOSS_TEST_MODE);
  await prepare(second.order_uid, "race-second-key", TOSS_TEST_MODE);
  await rows("update orders set payment_key='race-second-key', approved_at=now() where order_uid=$1", [
    second.order_uid,
  ]);

  await Promise.allSettled([
    rowsAs("", "service_role", "select * from complete_toss_refund_server($1,$2,$3,now(),$4,null,$5,'old refund replay')", [
      first.order_uid,
      "race-first-key",
      first.amount,
      "race-first-refund",
      ids.owner,
    ]),
    rowsAs("", "service_role", "select * from complete_toss_payment_server($1,$2,$3,$4,now())", [
      ids.buyer,
      second.order_uid,
      "race-second-key",
      second.amount,
    ]),
  ]);

  const [entitlement] = await rows(
    `select e.status, o.order_uid as granting_order_uid
       from product_entitlements e
       join orders o on o.id = e.payment_order_id
      where e.user_id=$1 and e.product_id=$2`,
    [ids.buyer, ids.feedbackProduct]
  );
  assert.equal(entitlement.status, "active");
  assert.equal(entitlement.granting_order_uid, second.order_uid);
}

async function concurrentAdminRevokeAndConfirmationDoNotUndoManualOverride() {
  await resetState();
  const order = await createPendingOrder("sns-monetization-feedback");
  await bindMode(order.order_uid, TOSS_TEST_MODE);
  await prepare(order.order_uid, "admin-race-confirm-key", TOSS_TEST_MODE);
  await rows("update orders set payment_key='admin-race-confirm-key', approved_at=now() where order_uid=$1", [
    order.order_uid,
  ]);
  await asOwner(() =>
    rows("select admin_grant_product_entitlement($1,$2,now()+interval '30 days')", [
      ids.buyer,
      ids.feedbackProduct,
    ])
  );
  const [adminEntitlement] = await rows(
    "select id from product_entitlements where user_id=$1 and product_id=$2",
    [ids.buyer, ids.feedbackProduct]
  );

  const attempts = await Promise.allSettled([
    rowsAs(ids.owner, "authenticated", "select admin_update_product_entitlement($1,'revoked',null)", [
      adminEntitlement.id,
    ]),
    rowsAs("", "service_role", "select * from complete_toss_payment_server($1,$2,$3,$4,now())", [
      ids.buyer,
      order.order_uid,
      "admin-race-confirm-key",
      order.amount,
    ]),
  ]);
  assert.equal(attempts[0].status, "fulfilled", "admin revoke must fulfill");
  assertExpectedConcurrentRejections(attempts.slice(1));

  const [entitlement] = await rows("select source, status from product_entitlements where id=$1", [
    adminEntitlement.id,
  ]);
  assert.equal(entitlement.status, "revoked", "concurrent confirmation must not undo admin/manual revoke");
  await assert.rejects(
    () => rowsAs("", "service_role", "select * from complete_toss_payment_server($1,$2,$3,$4,now())", [
      ids.buyer,
      order.order_uid,
      "admin-race-confirm-key",
      order.amount,
    ]),
    /grant revoked|review|required|expired|55000/i,
    "confirmation replay must not resurrect an admin/manual revoke"
  );
  const [afterReplay] = await rows("select status from product_entitlements where id=$1", [
    adminEntitlement.id,
  ]);
  assert.equal(afterReplay.status, "revoked");
}

function assertExpectedConcurrentRejections(results) {
  for (const result of results) {
    if (result.status === "fulfilled") continue;
    const code = result.reason?.code;
    const message = String(result.reason?.message ?? result.reason);
    assert.ok(
      code === "55000" || code === "40P01" || /review|required|revoked|deadlock|serialize|could not serialize/i.test(message),
      `unexpected concurrent rejection: ${code ?? "NO_CODE"} ${message}`
    );
  }
}

async function resetState() {
  await fixture.setActor("", "service_role");
  await rows("delete from payment_notifications");
  await rows("delete from payment_refunds");
  await rows("delete from payment_recovery_jobs");
  await rows("delete from payment_entitlement_grants");
  await rows("delete from product_entitlements");
  await rows("delete from orders");
}

async function createPendingOrder(slug) {
  return createPendingOrderFor(ids.buyer, slug);
}

async function createPendingOrderFor(userId, slug) {
  await fixture.setActor(userId, "authenticated");
  return (async () => {
    const [order] = await rows("select * from create_toss_payment_order($1)", [slug]);
    await rows("select record_toss_refund_policy_consent($1,'2026-07-29')", [order.order_uid]);
    return order;
  })();
}

async function bindMode(orderUid, mode, userId = ids.buyer) {
  await fixture.setActor("", "service_role");
  return rows("select * from bind_toss_order_mode_server($1,$2,$3)", [userId, orderUid, mode]);
}

async function approve(order, paymentKey) {
  await bindMode(order.order_uid, TOSS_TEST_MODE);
  await prepare(order.order_uid, paymentKey, TOSS_TEST_MODE);
  await rows("update orders set payment_key=$1, approved_at=now() where order_uid=$2", [
    paymentKey,
    order.order_uid,
  ]);
  await rows("select * from complete_toss_payment_server($1,$2,$3,$4,now())", [
    ids.buyer,
    order.order_uid,
    paymentKey,
    order.amount,
  ]);
}

async function refund(order, paymentKey, transactionKey) {
  await fixture.setActor("", "service_role");
  await rows("select * from complete_toss_refund_server($1,$2,$3,now(),$4,null,$5,'fixture refund')", [
    order.order_uid,
    paymentKey,
    order.amount,
    transactionKey,
    ids.owner,
  ]);
}

async function prepare(orderUid, paymentKey, mode, role = "service_role", userId = ids.buyer) {
  await fixture.setActor(role === "service_role" ? "" : userId, role);
  return rows("select * from prepare_toss_confirmation_server($1,$2,$3,$4,$5)", [
    userId,
    orderUid,
    paymentKey,
    await orderAmount(orderUid),
    mode,
  ]);
}

async function expireLeases() {
  const table = await recoveryJobTable();
  await rows(`update ${table} set lease_until=now()-interval '1 second'`);
}

async function orderAmount(orderUid) {
  const [order] = await rows("select amount from orders where order_uid=$1", [orderUid]);
  return order.amount;
}

async function asBuyer(callback) {
  await fixture.setActor(ids.buyer, "authenticated");
  return callback();
}

async function asOwner(callback) {
  await fixture.setActor(ids.owner, "authenticated");
  return callback();
}

async function relationExists(name) {
  const [row] = await rows("select to_regclass($1) is not null as exists", [`public.${name}`]);
  return row.exists;
}

async function columnExists(tableName, columnName) {
  const [row] = await rows(
    `select exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name=$1 and column_name=$2
     ) as exists`,
    [tableName, columnName]
  );
  return row.exists;
}

async function functionExists(name) {
  const [row] = await rows("select to_regproc($1) is not null as exists", [`public.${name}`]);
  return row.exists;
}

async function recoveryJobTable() {
  const candidates = await rows(
    `select table_name
       from information_schema.columns
      where table_schema='public'
        and column_name in ('operation', 'lease_token', 'lease_until', 'confirmation_key')
      group by table_name
     having count(distinct column_name) = 4
      order by table_name`
  );
  return candidates[0]?.table_name ?? null;
}

async function countRows(tableName, whereSql = "true", values = []) {
  assert.match(tableName, /^[a-z_]+$/);
  const [row] = await rows(`select count(*)::int as count from ${tableName} where ${whereSql}`, values);
  return row.count;
}
