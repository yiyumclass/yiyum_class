import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateWatchPercent,
  describeWatchProgress,
} from "../src/lib/admin/watch-progress.ts";

test("길이를 모르면 비율 없이 시청 시간만 보여 준다", () => {
  // 차시를 지우면 길이를 다시 읽을 수 없다. 0으로 나눠 NaN%를 띄우면 안 된다.
  assert.equal(describeWatchProgress(90, 0), "1:30");
});

test("길이를 알면 비율을 함께 보여 준다", () => {
  assert.equal(describeWatchProgress(30, 120), "0:30 (25%)");
});

test("길이보다 오래 본 기록은 100%로 자른다", () => {
  // 재생기가 끝에서 길이보다 큰 위치를 보고하는 일이 있다.
  assert.equal(calculateWatchPercent(130, 120), 100);
});

test("음수 위치는 0%로 본다", () => {
  assert.equal(calculateWatchPercent(-10, 120), 0);
});

test("길이가 0이거나 유효하지 않으면 0%로 본다", () => {
  assert.equal(calculateWatchPercent(50, 0), 0);
  assert.equal(calculateWatchPercent(50, Number.NaN), 0);
});

test("한 시간이 넘는 기록은 시:분:초로 보여 준다", () => {
  assert.equal(describeWatchProgress(3661, 7322), "1:01:01 (50%)");
});
