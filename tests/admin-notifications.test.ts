import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ModuleKind, transpileModule } from "typescript";
import { normalizeCashVariables, parseAdminTemplate, renderAdminTemplate } from "../src/lib/messaging/admin-notification-template.ts";
import { getAdminTemplate, hasPreviousTemplateMessage, listAdminTemplates } from "../src/lib/messaging/solapi-admin-templates.ts";
import { sendAdminNotificationOnce, type AdminSendOutcome } from "../src/lib/messaging/admin-notification-send.ts";
import { PaymentMessageRejected } from "../src/lib/messaging/solapi-payment-transport.ts";

const config = { apiKey: "fake", apiSecret: "fake", pfId: "channel" };
const rawTemplate = {
  templateId: "template", channelId: "channel", assignType: "CHANNEL", name: "수강 안내", status: "APPROVED", isHidden: false,
  messageType: "BA", emphasizeType: "TEXT", emphasizeTitle: "#{product} 안내", emphasizeSubtitle: "수강 안내",
  content: "#{name}님, #{product} 안내입니다.", variables: [{ name: "name" }, { name: "#{product}" }],
  extra: null, quickReplies: [], highlight: { title: null, description: null, imageId: null },
  item: { list: [], summary: { title: null, description: null } },
  buttons: [{ buttonType: "WL", buttonName: "입장", linkMo: "https://example.test/#{path}", linkPc: null }],
};

test("실제 응답의 강조 텍스트·빈 item·생략된 isDeleted와 버튼 변수를 처리한다", () => {
  const template = parseAdminTemplate(rawTemplate, config.pfId);
  assert.deepEqual(template.variables, ["#{name}", "#{path}", "#{product}"]);
  const rendered = renderAdminTemplate(template, { "#{name}": "김$&회원", "#{product}": "클래스", "#{path}": "course" });
  assert.equal(rendered.content, "김$&회원님, 클래스 안내입니다.");
  assert.equal(rendered.title, "클래스 안내");
  assert.equal(rendered.buttons[0].mobile, "https://example.test/course");
  assert.notEqual(template.fingerprint, parseAdminTemplate({ ...rawTemplate, emphasizeTitle: "변경" }, config.pfId).fingerprint);
});

test("미승인·다른 채널·그룹·숨김·삭제·미지원 내용을 잘못 미리보기 하지 않는다", () => {
  for (const changed of [{ status: "PENDING" }, { channelId: "other" }, { assignType: "GROUP" }, { isHidden: true }, { isDeleted: true },
    { emphasizeType: "IMAGE" }, { messageType: "AD" }, { item: { list: [{ title: "상품" }] } },
    { quickReplies: [{ name: "버튼" }] }, { variables: [{ name: "미리보기에 없는 값" }] },
    { buttons: [{ buttonType: "AL", buttonName: "앱", linkMo: "https://example.test" }] }]) {
    assert.throws(() => parseAdminTemplate({ ...rawTemplate, ...changed }, config.pfId));
  }
});

test("빈값·미치환 변수·추가값·과도한 길이·위험한 버튼은 차단한다", () => {
  const template = parseAdminTemplate(rawTemplate, config.pfId);
  const valid = { "#{name}": "회원", "#{product}": "클래스", "#{path}": "course" };
  for (const values of [{}, { ...valid, "#{name}": " " }, { ...valid, "#{name}": "#{another}" }, { ...valid, extra: "value" }, { ...valid, "#{name}": "a".repeat(501) }]) {
    assert.throws(() => renderAdminTemplate(template, values), /VARIABLES_INVALID/);
  }
  assert.throws(() => renderAdminTemplate({ ...template, content: "a".repeat(1001) }, valid), /MESSAGE_TOO_LONG/);
  assert.throws(() => renderAdminTemplate({ ...template, buttons: [{ name: "bad", mobile: "javascript:alert(1)", desktop: "" }] }, valid), /BUTTON_URL_INVALID/);
});

test("현금 금액은 양의 정수, 입금일은 달력 날짜·KST 오늘 이하만 허용한다", () => {
  const now = new Date("2026-10-05T15:10:00Z");
  assert.deepEqual(normalizeCashVariables({ "#{amount}": "1200000", "#{paymentDate}": "2026-10-06" }, now), { "#{amount}": "1,200,000", "#{paymentDate}": "2026.10.06" });
  for (const amount of ["0", "-1", "100.1", "1,200,000", "1000000000", ""]) {
    assert.throws(() => normalizeCashVariables({ "#{amount}": amount, "#{paymentDate}": "2026-10-05" }, now), /CASH_AMOUNT_INVALID/);
  }
  for (const date of ["2026-10-07", "2026-02-30", "2026-13-01", "2026-01-32", "2026/10/05", ""]) {
    assert.throws(() => normalizeCashVariables({ "#{amount}": "100", "#{paymentDate}": date }, now), /CASH_DATE_INVALID/);
  }
});

test("목록은 페이지 전체·내 채널·승인 필터·서버 인증으로 조회한다", async () => {
  let calls = 0;
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("channelId"), "channel");
    assert.equal(url.searchParams.get("isMine"), "true");
    assert.equal(url.searchParams.get("status"), "APPROVED");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.match(new Headers(init?.headers).get("Authorization")!, /^HMAC-SHA256 /);
    calls += 1;
    if (calls === 1) return Response.json({ templateList: [rawTemplate, { ...rawTemplate, channelId: "other" }], nextKey: "next" });
    assert.equal(url.searchParams.get("startKey"), "next");
    return Response.json({ templateList: [] });
  };
  const result = await listAdminTemplates(config, request);
  assert.equal(result.templates.length, 1);
  assert.equal(result.unsupported, 1);
  assert.equal(calls, 2);
  await assert.rejects(getAdminTemplate(config, "../../secrets", request), /TEMPLATE_INVALID/);
});

test("SOLAPI 직접 발송한 가입·현금 안내도 중복 검사하고 불완전 조회는 차단한다", async () => {
  const request: typeof fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("to"), "01012345678");
    assert.equal(url.searchParams.get("value"), "template,ATA");
    return Response.json({ messageList: { existing: { to: "01012345678", type: "ATA", kakaoOptions: { pfId: "channel", templateId: "template" }, statusCode: "4000" } } });
  };
  assert.equal(await hasPreviousTemplateMessage(config, "01012345678", "template", request), true);
  assert.equal(await hasPreviousTemplateMessage(config, "01012345678", "template", async () => Response.json({ messageList: {
    previous: { to: "+82 10-1234-5678", type: "ATA", kakaoOptions: { pfId: "channel", templateId: "template" } },
  } })), true);
  assert.equal(await hasPreviousTemplateMessage(config, "01012345678", "template", async () => Response.json({ messageList: {} })), false);
  await assert.rejects(hasPreviousTemplateMessage(config, "01012345678", "template", async () => Response.json({ messageList: {}, nextKey: "more" })), /DELIVERY_HISTORY_INCOMPLETE/);
  await assert.rejects(hasPreviousTemplateMessage(config, "01012345678", "template", async () => new Response("private", { status: 500 })), /SOLAPI_LOOKUP_FAILED/);
  await assert.rejects(hasPreviousTemplateMessage(config, "01012345678", "template", async () => Response.json({ messageList: [] })), /SOLAPI_RESPONSE_INVALID/);
});

test("DB 시작을 통과한 요청만 외부 발송하며 접수와 전달을 구분한다", async () => {
  let calls = 0;
  const outcomes: AdminSendOutcome[] = [];
  const ports = { begin: async () => false, send: async () => { calls += 1; return { messageId: "message", groupId: "group" }; }, finish: async (outcome: AdminSendOutcome) => { outcomes.push(outcome); } };
  assert.equal(await sendAdminNotificationOnce(ports), "already_started");
  assert.equal(calls, 0);
  ports.begin = async () => { throw new Error("DB result lost"); };
  await assert.rejects(sendAdminNotificationOnce(ports));
  assert.equal(calls, 0);
  ports.begin = async () => true;
  assert.equal(await sendAdminNotificationOnce(ports), "accepted");
  assert.equal(calls, 1);
  assert.equal(outcomes[0].status, "accepted");
});

test("모호한 결과·기록 실패는 재발송하지 않고 unknown으로 남긴다", async () => {
  for (const error of [new Error("network"), new PaymentMessageRejected("rejected"), null]) {
    let calls = 0;
    const outcomes: AdminSendOutcome[] = [];
    const status = await sendAdminNotificationOnce({
      begin: async () => true,
      send: async () => { calls += 1; if (error) throw error; return { messageId: "message", groupId: "group" }; },
      finish: async outcome => { outcomes.push(outcome); if (!error) throw new Error("DB unavailable"); },
    });
    assert.equal(calls, 1);
    assert.equal(status, error instanceof PaymentMessageRejected ? "rejected" : "unknown");
    assert.equal(outcomes.length, 1);
  }
});

function loadActions(authorize: boolean) {
  const source = readFileSync(new URL("../src/app/admin/members/notification-actions.ts", import.meta.url), "utf8");
  const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } });
  const calls: unknown[][] = [];
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const modules: Record<string, unknown> = {
    "@/lib/admin/auth": { requireOwnerAdmin: async () => { if (!authorize) throw new Error("denied"); return { userId: "owner" }; } },
    "@/lib/messaging/admin-notifications": Object.fromEntries([
      ...["loadNotificationPanel", "previewAdminNotification", "confirmAdminNotification", "loadNotificationHistory", "reconcileAdminNotificationDeliveries"].map(name => [name, async (...args: unknown[]) => { calls.push([name, ...args]); return "ok"; }]),
      ["adminNotificationError", () => "safe error"],
    ]),
  };
  new Function("require", "exports", compiled.outputText)((name: string) => { assert.ok(Object.hasOwn(modules, name)); return modules[name]; }, exports);
  return { actions: exports, calls };
}

test("목록·미리보기·확인·이력 작업 모두 owner 권한을 먼저 검사한다", async () => {
  const blocked = loadActions(false);
  for (const action of Object.values(blocked.actions)) await assert.rejects(action("arbitrary"), /denied/);
  assert.equal(blocked.calls.length, 0);
  const allowed = loadActions(true);
  await allowed.actions.previewMemberNotificationAction({ memberId: "member" });
  await allowed.actions.sendMemberNotificationAction("draft");
  assert.deepEqual(allowed.calls, [["previewAdminNotification", "owner", { memberId: "member" }], ["confirmAdminNotification", "owner", "draft"]]);
});
