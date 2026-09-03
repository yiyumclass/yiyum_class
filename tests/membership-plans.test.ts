import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  enrollmentOptionDefinitions,
  getMembershipAccessLabel,
  getHighestMembershipPlanSlug,
  isMembershipPlanSlug,
  membershipPlanDefinitions,
  phonePassDefinition,
} from "../src/lib/store/membership-plans.ts";

test("클래스 세 등급은 고유한 상품 주소와 총 결제금액을 가진다", () => {
  assert.deepEqual(
    membershipPlanDefinitions.map((plan) => [plan.slug, plan.fallbackPriceKrw]),
    [
      ["sns-monetization", 930_000],
      ["sns-monetization-feedback", 1_200_000],
      ["sns-monetization-ultra", 2_990_000],
    ]
  );
  assert.equal(new Set(membershipPlanDefinitions.map((plan) => plan.slug)).size, 3);
  assert.equal(isMembershipPlanSlug("sns-monetization-feedback"), true);
  assert.equal(isMembershipPlanSlug(phonePassDefinition.slug), false);
});

test("상위 클래스는 하위 클래스의 혜택을 모두 포함한다", () => {
  const [vod, feedback, ultra] = membershipPlanDefinitions;
  const normalizeBenefit = (benefit: string) => benefit.replace(/ 제공$/, "");
  assert.ok(
    vod.benefits.every((benefit) =>
      feedback.benefits.map(normalizeBenefit).includes(normalizeBenefit(benefit))
    )
  );
  assert.ok(feedback.benefits.every((benefit) => ultra.benefits.includes(benefit)));
  assert.match(ultra.benefits.join(" "), /10분 사용권 × 6회 제공/);
});

test("선택창은 요청한 네 가지 상품 문구를 순서대로 제공한다", () => {
  assert.deepEqual(
    enrollmentOptionDefinitions.map(({ order, icon, title }) => ({ order, icon, title })),
    [
      { order: 1, icon: "🎬", title: "베이직 클래스" },
      { order: 2, icon: "🔥", title: "부스터 클래스" },
      { order: 3, icon: "👑", title: "프리미엄 클래스" },
      { order: 4, icon: "📞", title: "이윰 1:1 전화권" },
    ]
  );
  assert.equal(
    enrollmentOptionDefinitions[0].description,
    "혼자, 내 속도대로 배우는 기본 과정"
  );
  assert.match(enrollmentOptionDefinitions[1].description, /과제\+피드백/);
  assert.match(enrollmentOptionDefinitions[2].description, /가장 밀착된 피드백/);
});

test("별도 전화권은 33만원 총액과 6회 제공 문구를 유지한다", () => {
  assert.equal(phonePassDefinition.slug, "yiyum-phone-pass");
  assert.equal(phonePassDefinition.fallbackPriceKrw, 330_000);
  assert.match(phonePassDefinition.description, /10분씩 총 6회/);
  assert.equal(getMembershipAccessLabel(phonePassDefinition.slug), "10분 × 6회 이용");
});

test("같은 VOD 등급을 여러 개 보유하면 가장 높은 등급을 선택한다", () => {
  assert.equal(
    getHighestMembershipPlanSlug([
      "sns-monetization",
      "sns-monetization-ultra",
      "sns-monetization-feedback",
    ]),
    "sns-monetization-ultra"
  );
  assert.equal(getHighestMembershipPlanSlug(["unrelated-course"]), null);
});

test("멤버십 마이그레이션은 총액 상품과 동일 원본 강의 범위를 만든다", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260830100000_create_membership_tiers.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(migration, /'sns-monetization-feedback'[\s\S]*?1200000/i);
  assert.match(migration, /'sns-monetization-ultra'[\s\S]*?2990000/i);
  assert.match(migration, /'yiyum-phone-pass'[\s\S]*?330000/i);
  assert.doesNotMatch(migration, /zoom-consulting-1on1/i);
  assert.match(migration, /insert into public\.product_course_scopes/i);
  assert.match(migration, /access_mode[\s\S]*?'full'/i);
  assert.match(migration, /function public\.has_active_course_access/i);
  assert.match(migration, /block_duplicate_membership_payment_order/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /fail_pending_membership_orders_after_entitlement/i);
});

test("진도 저장은 상품 slug가 아니라 원본 강의 접근 권한을 확인한다", () => {
  const route = readFileSync(
    new URL("../src/app/api/learning/progress/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(route, /hasActiveCourseAccess/);
  assert.match(route, /loadMyCourseByContentSlug/);
  assert.doesNotMatch(route, /hasActiveProductEntitlement/);
});

test("결제 승인 직전에 멤버십 그룹 이용권을 다시 확인한다", () => {
  const route = readFileSync(
    new URL("../src/app/api/payments/toss/confirm/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(route, /isMembershipPlanSlug\(targetProduct\.slug\)/);
  assert.match(route, /loadMyActiveProductEntitlements/);
  assert.match(route, /fail_toss_payment_order/);
});

test("이미 완료된 Toss 결제도 확인 API와 웹훅에서 누락 이용권을 복구한다", () => {
  const confirmRoute = readFileSync(
    new URL("../src/app/api/payments/toss/confirm/route.ts", import.meta.url),
    "utf8"
  );
  const webhookRoute = readFileSync(
    new URL("../src/app/api/payments/toss/webhook/route.ts", import.meta.url),
    "utf8"
  );

  const paidConfirmBranch = confirmRoute.slice(
    confirmRoute.indexOf('if (data.status === "paid")'),
    confirmRoute.indexOf('if (data.status !== "pending")')
  );
  assert.match(paidConfirmBranch, /completePaymentOrder\(/);
  assert.match(paidConfirmBranch, /revalidateCompletedPayment\(/);
  assert.match(webhookRoute, /const alreadyProcessed =[\s\S]*order\.status === "paid"/);
  assert.match(webhookRoute, /admin\.rpc\("complete_toss_payment_server"/);
});

test("공개 강의는 하나로 보이고 가격은 수강 신청 뒤에만 노출한다", () => {
  const home = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const courseList = readFileSync(
    new URL("../src/app/courses/page.tsx", import.meta.url),
    "utf8"
  );
  const publicSale = readFileSync(
    new URL("../src/lib/store/public-sale.ts", import.meta.url),
    "utf8"
  );
  const picker = readFileSync(
    new URL(
      "../src/components/store/CourseEnrollmentPicker.tsx",
      import.meta.url
    ),
    "utf8"
  );
  const pickerStyles = readFileSync(
    new URL(
      "../src/components/store/CourseEnrollmentPicker.module.css",
      import.meta.url
    ),
    "utf8"
  );

  assert.doesNotMatch(home, /원부터/);
  assert.match(home, /수강 방식 선택/);
  assert.match(courseList, /item\.productType === "course"/);
  assert.match(courseList, /상세에서 수강 방식을 선택할 수 있어요/);
  assert.match(publicSale, /collapseMembershipCourseOptions/);
  assert.match(publicSale, /isMembershipPlanSlug/);
  assert.match(picker, /dialog = open \?/);
  assert.match(picker, /총 결제금액/);
  assert.match(picker, /const installmentMonths = 12/);
  assert.match(picker, /\{installmentMonths\}개월 할부 기준/);
  assert.doesNotMatch(pickerStyles, /\.installmentGuide\s*\{[^}]*background:/);
  assert.doesNotMatch(pickerStyles, /\.installmentGuide\s*\{[^}]*border:/);
  assert.match(picker, /aria-modal="true"/);
});

test("토스 결제창은 구매자가 최대 12개월 할부를 선택할 수 있게 연다", () => {
  const paymentForm = readFileSync(
    new URL("../src/components/checkout/TossPaymentForm.tsx", import.meta.url),
    "utf8"
  );

  assert.match(paymentForm, /maxCardInstallmentPlan:\s*12/);
  assert.doesNotMatch(paymentForm, /freeInstallmentPlans/);
});
