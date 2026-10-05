import assert from "node:assert/strict";
import test from "node:test";
import { lookupKakaoPhone } from "../src/lib/auth/kakao-phone-request.ts";
import { NotificationContactError, resolveNotificationContact, type NotificationContactPorts, type VerifiedNotificationContact } from "../src/lib/messaging/notification-contact.ts";

const user = { id: "user", identities: [{ provider: "kakao", id: "123", identity_data: { sub: "123" } }] };
const now = Date.parse("2026-10-05T12:00:00Z");

function fixture(contact: VerifiedNotificationContact | null = null) {
  const saved: VerifiedNotificationContact[] = [];
  let lookups = 0;
  let removals = 0;
  const ports: NotificationContactPorts = {
    load: async () => contact,
    save: async (_userId, value) => { saved.push(value); },
    remove: async () => { removals += 1; },
    lookup: async expectedId => { assert.equal(expectedId, "123"); lookups += 1; return { ok: true, phone: "01012345678" }; },
  };
  return { ports, saved, lookups: () => lookups, removals: () => removals };
}

test("기존 카카오 회원은 재로그인 없이 검증 연락처를 저장하고 사용한다", async () => {
  const state = fixture();
  assert.equal(await resolveNotificationContact(user, state.ports, { now }), "01012345678");
  assert.deepEqual(state.saved, [{ kakao_user_id: "123", phone: "01012345678", verified_at: new Date(now).toISOString() }]);
});

test("같은 카카오 회원번호의 유효한 서버 저장 연락처만 재사용한다", async () => {
  const state = fixture({ kakao_user_id: "123", phone: "01012345678", verified_at: new Date(now - 1000).toISOString() });
  assert.equal(await resolveNotificationContact(user, state.ports, { now }), "01012345678");
  assert.equal(state.lookups(), 0);
  await resolveNotificationContact(user, state.ports, { now, refresh: true });
  assert.equal(state.lookups(), 1);
});

test("다른 계정·만료·미래 시각·잘못된 번호는 카카오에서 재조회한다", async () => {
  for (const change of [{ kakao_user_id: "456" }, { verified_at: new Date(now - 86400000).toISOString() }, { verified_at: new Date(now + 1000).toISOString() }, { phone: "invalid" }]) {
    const state = fixture({ kakao_user_id: "123", phone: "01012345678", verified_at: new Date(now).toISOString(), ...change });
    await resolveNotificationContact(user, state.ports, { now });
    assert.equal(state.lookups(), 1);
  }
});

test("사용자 수정 가능 metadata의 전화번호와 모호한 identity는 신뢰하지 않는다", async () => {
  const state = fixture();
  await assert.rejects(resolveNotificationContact({ id: "user", identities: [] }, state.ports), NotificationContactError);
  await assert.rejects(resolveNotificationContact({ ...user, identities: [...user.identities, ...user.identities] }, state.ports), NotificationContactError);
  assert.equal(state.lookups(), 0);
});

test("동의 철회 또는 계정 불일치는 캐시를 제거하고 연락처 확인 상태로 구분한다", async () => {
  for (const code of ["PHONE_CONSENT_REQUIRED", "PHONE_UNAVAILABLE", "KAKAO_ID_MISMATCH"] as const) {
    const state = fixture();
    state.ports.lookup = async () => ({ ok: false, code });
    await assert.rejects(resolveNotificationContact(user, state.ports), error => error instanceof NotificationContactError && error.needsContact);
    assert.equal(state.removals(), 1);
    assert.equal(state.saved.length, 0);
  }
});

test("API 장애는 만료 연락처로 우회하지 않고 DB 저장 실패도 발송으로 진행하지 않는다", async () => {
  const state = fixture({ kakao_user_id: "123", phone: "01012345678", verified_at: new Date(now - 86400000).toISOString() });
  state.ports.lookup = async () => ({ ok: false, code: "KAKAO_LOOKUP_FAILED" });
  await assert.rejects(resolveNotificationContact(user, state.ports, { now }), error => error instanceof NotificationContactError && !error.needsContact);
  const storageFailure = fixture();
  storageFailure.ports.save = async () => { throw new NotificationContactError("CONTACT_STORAGE_FAILED"); };
  await assert.rejects(resolveNotificationContact(user, storageFailure.ports), /CONTACT_STORAGE_FAILED/);
});

test("어드민 키 조회는 올바른 대상·범위로 GET 요청하며 휴대전화만 반환한다", async () => {
  let calls = 0;
  const request: typeof fetch = async (input, init) => {
    calls += 1;
    const url = new URL(String(input));
    assert.equal(url.origin, "https://kapi.kakao.com");
    assert.equal(url.pathname, "/v2/user/me");
    assert.equal(url.searchParams.get("target_id"), "123");
    assert.equal(url.searchParams.get("target_id_type"), "user_id");
    assert.deepEqual(JSON.parse(url.searchParams.get("property_keys")!), ["kakao_account.phone_number"]);
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("authorization"), "KakaoAK fake-key");
    assert.equal(init?.redirect, "error");
    return Response.json({ id: 123, kakao_account: { phone_number: "+82 10-1234-5678", phone_number_needs_agreement: false } });
  };
  assert.deepEqual(await lookupKakaoPhone({ kakaoUserId: "123", adminKey: " fake-key " }, request), { ok: true, phone: "01012345678" });
  assert.equal(calls, 1);
});

test("로그인 토큰 조회도 카카오 회원번호와 명시적인 동의 결과를 검증한다", async () => {
  const request: typeof fetch = async (input, init) => {
    assert.equal(new URL(String(input)).searchParams.has("target_id"), false);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fake-token");
    return Response.json({ id: 999, kakao_account: { phone_number: "01012345678", phone_number_needs_agreement: false } });
  };
  assert.deepEqual(await lookupKakaoPhone({ kakaoUserId: "123", accessToken: "fake-token" }, request), { ok: false, code: "KAKAO_ID_MISMATCH" });
  for (const agreement of [true, undefined]) {
    const result = await lookupKakaoPhone({ kakaoUserId: "123", adminKey: "fake-key" }, async () => Response.json({ id: 123, kakao_account: { phone_number: "01012345678", phone_number_needs_agreement: agreement } }));
    assert.deepEqual(result, { ok: false, code: "PHONE_CONSENT_REQUIRED" });
  }
});

test("키 누락은 요청하지 않고 API 거절·잘못된 응답·네트워크 오류는 고정 코드만 반환한다", async () => {
  assert.deepEqual(await lookupKakaoPhone({ kakaoUserId: "123" }, async () => { throw new Error("must not call"); }), { ok: false, code: "KAKAO_CONFIGURATION_MISSING" });
  for (const request of [async () => new Response("private", { status: 403 }), async () => new Response("not json"), async () => { throw new Error("private key"); }]) {
    const result = await lookupKakaoPhone({ kakaoUserId: "123", adminKey: "fake" }, request);
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes("private"), false);
  }
});

test("64비트 회원번호를 반올림하지 않고 중첩 ID나 숫자 접두사로 계정을 혼동하지 않는다", async () => {
  const account = '"kakao_account":{"phone_number":"01012345678","phone_number_needs_agreement":false}';
  const largeId = "9223372036854775806";
  assert.deepEqual(await lookupKakaoPhone({ kakaoUserId: largeId, adminKey: "fake" }, async () => new Response(`{"id":${largeId},${account}}`)), { ok: true, phone: "01012345678" });
  for (const body of [`{"nested":{"id":123},"id":999,${account}}`, `{"id":123e3,${account}}`, `{"id":123.5,${account}}`]) {
    assert.deepEqual(await lookupKakaoPhone({ kakaoUserId: "123", adminKey: "fake" }, async () => new Response(body)), { ok: false, code: "KAKAO_ID_MISMATCH" });
  }
});
