import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkNewPassword,
  isLikelyEmail,
} from "../src/lib/auth/password.ts";

test("길이와 확인값이 맞으면 통과한다", () => {
  assert.deepEqual(checkNewPassword("correct-horse", "correct-horse"), { ok: true });
});

test("최소 길이 미만은 거절한다", () => {
  const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
  const result = checkNewPassword(short, short);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.message : "", /8자 이상/);
});

test("경계값인 최소 길이는 통과한다", () => {
  const exact = "a".repeat(MIN_PASSWORD_LENGTH);
  assert.deepEqual(checkNewPassword(exact, exact), { ok: true });
});

test("bcrypt가 잘라내는 길이를 넘기면 거절한다", () => {
  const tooLong = "a".repeat(MAX_PASSWORD_LENGTH + 1);
  const result = checkNewPassword(tooLong, tooLong);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.message : "", /이하/);
});

test("공백만으로 이루어진 비밀번호는 거절한다", () => {
  const spaces = " ".repeat(MIN_PASSWORD_LENGTH + 2);
  const result = checkNewPassword(spaces, spaces);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.message : "", /공백/);
});

test("확인값이 다르면 거절한다", () => {
  const result = checkNewPassword("correct-horse", "correct-horsE");
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.message : "", /일치하지/);
});

test("이메일 형식을 가려낸다", () => {
  assert.equal(isLikelyEmail("user@example.com"), true);
  assert.equal(isLikelyEmail("  user@example.com  "), true);

  for (const invalid of ["", "user", "user@", "@example.com", "user@example", "a b@c.com"]) {
    assert.equal(isLikelyEmail(invalid), false, `${invalid}는 이메일이 아니다`);
  }
});
