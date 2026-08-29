import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACCOUNT_WITHDRAWAL_CONFIRMATION,
  ACCOUNT_WITHDRAWAL_REAUTH_WINDOW_MS,
  hasRecentAuthentication,
  isValidWithdrawalConfirmation,
  parseKakaoUnlinkResponse,
  readKakaoUserId,
} from "../src/lib/auth/account-withdrawal.ts";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260829110000_create_account_withdrawal_flow.sql",
    import.meta.url
  ),
  "utf8"
);
const actionSource = readFileSync(
  new URL("../src/app/account/settings/actions.ts", import.meta.url),
  "utf8"
);
const kakaoSource = readFileSync(
  new URL("../src/lib/auth/kakao-unlink.ts", import.meta.url),
  "utf8"
);

test("회원탈퇴 확인 문구는 공백을 제외하고 정확히 일치해야 한다", () => {
  assert.equal(ACCOUNT_WITHDRAWAL_CONFIRMATION, "회원탈퇴");
  assert.equal(isValidWithdrawalConfirmation("회원탈퇴"), true);
  assert.equal(isValidWithdrawalConfirmation(" 회원탈퇴 "), true);
  assert.equal(isValidWithdrawalConfirmation("탈퇴"), false);
});

test("민감한 탈퇴 작업은 최근 로그인 세션만 허용한다", () => {
  const now = Date.parse("2026-08-29T01:00:00.000Z");
  assert.equal(
    hasRecentAuthentication(
      new Date(now - ACCOUNT_WITHDRAWAL_REAUTH_WINDOW_MS).toISOString(),
      now
    ),
    true
  );
  assert.equal(
    hasRecentAuthentication(
      new Date(now - ACCOUNT_WITHDRAWAL_REAUTH_WINDOW_MS - 1).toISOString(),
      now
    ),
    false
  );
  assert.equal(hasRecentAuthentication(undefined, now), false);
});

test("Supabase 카카오 identity에서 숫자 회원번호를 문자열로 보존한다", () => {
  assert.equal(
    readKakaoUserId([
      {
        id: "fallback-id",
        provider: "kakao",
        identity_data: { sub: "987654321012345678" },
      },
    ]),
    "987654321012345678"
  );
  assert.equal(readKakaoUserId([{ id: "12345", provider: "kakao" }]), "12345");
  assert.equal(readKakaoUserId([{ id: "abc", provider: "kakao" }]), null);
});

test("카카오 연결 해제 응답은 큰 회원번호도 정밀도 손실 없이 검증한다", () => {
  assert.deepEqual(
    parseKakaoUnlinkResponse(
      200,
      '{"id":987654321012345678}',
      "987654321012345678"
    ),
    { ok: true, userId: "987654321012345678" }
  );
  assert.deepEqual(
    parseKakaoUnlinkResponse(400, '{"code":-101,"msg":"NotRegisteredUser"}', "123"),
    { ok: false, code: -101, reason: "api" }
  );
  assert.equal(parseKakaoUnlinkResponse(200, '{"id":124}', "123").ok, false);
});

test("탈퇴 마이그레이션은 회원 데이터만 파기하고 거래 원장을 보존한다", () => {
  assert.match(migration, /delete from public\.lesson_progress where user_id = target_user_id/i);
  assert.match(migration, /delete from public\.product_entitlements where user_id = target_user_id/i);
  assert.match(migration, /delete from public\.user_auth_consents where user_id = target_user_id/i);
  assert.doesNotMatch(migration, /delete from public\.orders where user_id = target_user_id/i);
  assert.doesNotMatch(migration, /delete from public\.payment_refunds/i);
  assert.match(migration, /active_admin_account/);
  assert.match(migration, /payment_in_progress/);
  assert.match(migration, /refund_in_progress/);
});

test("탈퇴 RPC와 Auth 삭제는 서버 권한과 soft delete를 사용한다", () => {
  assert.match(migration, /auth\.role\(\)\) <> 'service_role'/i);
  assert.match(
    migration,
    /grant execute on function public\.begin_account_withdrawal\(uuid, text\) to service_role/i
  );
  assert.match(actionSource, /unlinkKakaoAccount\(kakaoUserId\)/);
  assert.match(actionSource, /deleteUser\(user\.id, true\)/);
  assert.ok(
    actionSource.indexOf("unlinkKakaoAccount(kakaoUserId)") <
      actionSource.indexOf("deleteUser(user.id, true)")
  );
  assert.match(kakaoSource, /import "server-only"/);
  assert.match(kakaoSource, /process\.env\.KAKAO_ADMIN_KEY/);
  assert.doesNotMatch(kakaoSource, /NEXT_PUBLIC_KAKAO/);
});
