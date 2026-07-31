import assert from "node:assert/strict";
import test from "node:test";
import { describeAuditMetadata } from "../src/lib/admin/audit-labels.ts";

test("before/after 쌍을 바뀐 줄만 남기고 편다", () => {
  const rows = describeAuditMetadata({
    before: { status: "active", title: "같은 제목" },
    after: { status: "paused", title: "같은 제목" },
  });

  assert.deepEqual(rows, [
    { key: "status", label: "상태", before: "active", after: "paused" },
  ]);
});

test("같은 필드가 최상위와 before/after에 함께 있어도 줄이 겹치지 않는다", () => {
  // 트리거가 바뀐 값을 최상위에도 함께 남기는 모양. 걸러내지 않으면 같은 줄이
  // 두 번 나오고 React key까지 겹친다.
  const rows = describeAuditMetadata({
    status: "paused",
    slug: "sns-monetization",
    before: { status: "active" },
    after: { status: "paused" },
  });

  const keys = rows.map((row) => row.key);
  assert.equal(new Set(keys).size, keys.length, "key가 중복되면 안 된다");
  assert.deepEqual(keys.toSorted(), ["slug", "status"]);

  const status = rows.find((row) => row.key === "status");
  assert.equal(status?.before, "active", "최상위 값이 아니라 변경 이력을 보여야 한다");
  assert.equal(status?.after, "paused");
});

test("before/after에서 안 바뀐 필드는 최상위에서도 다시 나오지 않는다", () => {
  const rows = describeAuditMetadata({
    title: "같은 제목",
    before: { title: "같은 제목" },
    after: { title: "같은 제목" },
  });

  assert.deepEqual(rows, [], "숨기기로 한 필드가 다른 경로로 새어 나오면 안 된다");
});

test("평평한 metadata는 그대로 편다", () => {
  const rows = describeAuditMetadata({
    order_uid: "ORD-1",
    amount: 300000,
    refunded: true,
    missing: null,
  });

  assert.deepEqual(rows.map((row) => [row.key, row.after]), [
    ["order_uid", "ORD-1"],
    ["amount", "300,000"],
    ["refunded", "예"],
    ["missing", "—"],
  ]);
  assert.ok(rows.every((row) => row.before === null));
});

test("before만 있고 after가 없어도 처리한다", () => {
  const rows = describeAuditMetadata({ before: { status: "active" } });

  assert.deepEqual(rows, [
    { key: "status", label: "상태", before: "active", after: "—" },
  ]);
});

test("중첩 객체와 배열도 한 칸 문자열로 만든다", () => {
  const rows = describeAuditMetadata({ payload: { a: 1 }, tags: ["x", "y"] });

  assert.deepEqual(rows.map((row) => row.after), ['{"a":1}', '["x","y"]']);
});
