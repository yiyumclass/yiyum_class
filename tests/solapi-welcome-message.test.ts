import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeKoreanMobileNumber,
  readAuthUserMobileNumber,
} from "../src/lib/messaging/phone.ts";

const callbackRoute = readFileSync(
  new URL("../src/app/auth/callback/route.ts", import.meta.url),
  "utf8"
);
const solapiSender = readFileSync(
  new URL("../src/lib/messaging/solapi.ts", import.meta.url),
  "utf8"
);
const kakaoStartRoute = readFileSync(
  new URL("../src/app/auth/kakao/start/route.ts", import.meta.url),
  "utf8"
);

test("Kakao and domestic mobile numbers normalize to SOLAPI format", () => {
  assert.equal(normalizeKoreanMobileNumber("+82 10-1234-5678"), "01012345678");
  assert.equal(normalizeKoreanMobileNumber("82-10-1234-5678"), "01012345678");
  assert.equal(normalizeKoreanMobileNumber("010-1234-5678"), "01012345678");
  assert.equal(normalizeKoreanMobileNumber("02-1234-5678"), null);
  assert.equal(normalizeKoreanMobileNumber("010-123-4567"), null);
});

test("Auth user phone takes precedence and Kakao metadata remains supported", () => {
  assert.equal(
    readAuthUserMobileNumber({
      phone: "010-1111-2222",
      user_metadata: { phone_number: "+82 10-3333-4444" },
    }),
    "01011112222"
  );
  assert.equal(
    readAuthUserMobileNumber({
      user_metadata: { phone_number: "+82 10-3333-4444" },
    }),
    "01033334444"
  );
});

test("welcome Alimtalk is server-only, has no SMS fallback, and cannot block signup", () => {
  assert.match(solapiSender, /import "server-only"/);
  assert.match(solapiSender, /SOLAPI_API_SECRET/);
  assert.match(solapiSender, /disableSms: true/);
  assert.doesNotMatch(solapiSender, /NEXT_PUBLIC_SOLAPI/);

  assert.match(callbackRoute, /Boolean\(consentIntent\)/);
  assert.match(callbackRoute, /isRecentlyCreated\(user\.created_at\)/);
  assert.match(callbackRoute, /after\(async \(\) =>/);
  assert.match(callbackRoute, /catch \(error\)/);
});

test("signup consent survives the Kakao OAuth round trip without relying on one cookie", () => {
  assert.match(kakaoStartRoute, /OAUTH_CONSENT_QUERY_PARAM/);
  assert.match(
    kakaoStartRoute,
    /redirectTo\.searchParams\.set\(OAUTH_CONSENT_QUERY_PARAM, consentIntentValue\)/
  );
  assert.match(callbackRoute, /const cookieConsentIntent/);
  assert.match(callbackRoute, /const queryConsentIntent/);
  assert.match(
    callbackRoute,
    /const consentIntent = cookieConsentIntent \?\? queryConsentIntent/
  );
});
