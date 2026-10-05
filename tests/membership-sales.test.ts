import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { AdminProduct } from "../src/lib/admin/products.ts";
import type { MembershipProductOption } from "../src/components/store/CourseEnrollmentPicker.tsx";
import type { SaleDetail } from "../src/lib/store/public-sale.ts";
import * as plans from "../src/lib/store/membership-plans.ts";
import * as pricing from "../src/lib/store/pricing.ts";
import * as availability from "../src/lib/store/sale-availability.ts";

const nodeRequire = createRequire(import.meta.url);
const productId = "10000000-0000-4000-8000-000000000001";
const sharedDependencies: Record<string, unknown> = {
  "react/jsx-runtime": nodeRequire("react/jsx-runtime"),
  "@/lib/store/membership-plans": plans,
  "@/lib/store/pricing": pricing,
  "@/lib/store/sale-availability": availability,
};

function loadModule<Exports>(path: string, dependencies: Record<string, unknown>, globals = {}) {
  const exports = {};
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText, {
    exports,
    console: { error() {} },
    ...globals,
    require: (name: string) => {
      if (name in dependencies) return dependencies[name];
      if (name in sharedDependencies) return sharedDependencies[name];
      if (name.endsWith(".module.css")) return new Proxy({}, { get: (_target, key) => key });
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports as Exports;
}

test("판매 중만 구매할 수 있고 품절, 작성 중, 누락은 구분한다", () => {
  assert.equal(availability.getSaleAvailability("active").canPurchase, true);
  for (const status of ["sold_out", "draft", "paused", "archived", "unknown", null, undefined]) {
    assert.equal(availability.getSaleAvailability(status).canPurchase, false);
  }
  assert.equal(availability.getSaleAvailability("sold_out").label, "품절");
  assert.equal(availability.getSaleAvailability("draft").label, "작성 중");
  assert.equal(availability.getSaleAvailability(undefined).status, "missing");
  assert.equal(availability.getSaleAvailabilitySummary(["sold_out", "sold_out", "sold_out"]), "all_sold_out");
  assert.equal(availability.getSaleAvailabilitySummary(["active", "sold_out", "draft"]), "mixed");
  assert.equal(availability.getSaleAvailabilitySummary(["draft", undefined, "sold_out"]), "unavailable");
  assert.equal(availability.getSaleAvailabilitySummary([]), "unavailable");
});

function renderPicker(statuses: Array<string | undefined>) {
  const subject = loadModule<{ CourseEnrollmentProvider: React.ComponentType<{ products: MembershipProductOption[]; children?: React.ReactNode }> }>(
    "components/store/CourseEnrollmentPicker.tsx",
    {
      react: { ...React, useState: () => [true, () => {}], useEffect: () => {} },
      "react-dom": { createPortal: (children: React.ReactNode) => children },
      "next/link": { __esModule: true, default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement("a", props) },
    },
    { document: {} }
  );
  const products = plans.membershipPlanDefinitions.flatMap((plan, index) => statuses[index] === undefined ? [] : [{
    slug: plan.slug,
    title: plan.title,
    priceKrw: plan.fallbackPriceKrw,
    soldOut: statuses[index] === "sold_out",
    status: statuses[index],
    checkoutHref: `/checkout?product=${plan.slug}`,
  }]);
  return renderToStaticMarkup(React.createElement(subject.CourseEnrollmentProvider, { products }, null));
}

test("혼합 등급은 품절 등급의 CTA만 막고 세 가격과 혜택은 유지한다", () => {
  const markup = renderPicker(["active", "sold_out", "active"]);
  assert.match(markup, /href="\/checkout\?product=sns-monetization"/);
  assert.match(markup, /href="\/checkout\?product=sns-monetization-ultra"/);
  assert.doesNotMatch(markup, /href="\/checkout\?product=sns-monetization-feedback"/);
  assert.match(markup, /<button[^>]*disabled="">품절<\/button>/);
  for (const plan of plans.membershipPlanDefinitions) {
    assert.ok(markup.includes(pricing.formatKrw(plan.fallbackPriceKrw)));
    assert.ok(markup.includes(plan.description));
    for (const benefit of plan.benefits) assert.ok(markup.includes(benefit));
  }
});

test("모두 품절이면 비교창과 가격을 유지하고 모든 구매 링크를 제거한다", () => {
  const markup = renderPicker(["sold_out", "sold_out", "sold_out"]);
  assert.match(markup, /현재 모든 등급이 품절/);
  assert.equal((markup.match(/disabled="">품절<\/button>/g) ?? []).length, 3);
  assert.doesNotMatch(markup, /href="\/checkout/);
  assert.equal((markup.match(/총 결제금액/g) ?? []).length, 4);
});

test("작성 중·누락은 품절로 오인하지 않고 구매 링크도 만들지 않는다", () => {
  const markup = renderPicker(["draft", undefined, "sold_out"]);
  assert.match(markup, /현재 신청 가능한 등급이 없습니다/);
  assert.match(markup, /disabled="">작성 중<\/button>/);
  assert.match(markup, /disabled="">판매 준비 중<\/button>/);
  assert.doesNotMatch(markup, /현재 모든 등급이 품절|href="\/checkout/);
});

test("상세 페이지 마감 문구는 대표 등급이 아니라 전체 등급 상태를 따른다", () => {
  const emptyComponent = () => null;
  const subject = loadModule<{ default: React.ComponentType<{ item: SaleDetail; membershipProducts: MembershipProductOption[] }> }>(
    "components/store/SaleDetailPage.tsx",
    {
      "next/image": emptyComponent,
      "next/link": (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement("a", props),
      "@/components/layout/SiteFooter": emptyComponent,
      "@/components/layout/SiteHeader": emptyComponent,
      "./CoursePurchasePolicy": emptyComponent,
      "./ConsultingDetail": emptyComponent,
      "./ResourceDetail": emptyComponent,
      "./ResourceViewer": emptyComponent,
      "./CourseEnrollmentPicker": {
        __esModule: true,
        default: emptyComponent,
        CourseEnrollmentProvider: ({ children }: { children: React.ReactNode }) => children,
      },
    }
  );
  const item = { productType: "course", title: "공통 클래스", facts: [], soldOut: true, priceKrw: 930000, listPriceKrw: null } as unknown as SaleDetail;
  const products = plans.membershipPlanDefinitions.map((plan, index) => ({
    slug: plan.slug, title: plan.title, priceKrw: plan.fallbackPriceKrw,
    soldOut: index === 0, checkoutHref: `/checkout?product=${plan.slug}`,
  }));
  const render = () => renderToStaticMarkup(React.createElement(subject.default, { item, membershipProducts: products }));
  assert.match(render(), /내 속도에 맞춰 시작해 보세요/);
  assert.doesNotMatch(render(), /이번 모집은 마감/);
  products.forEach((product) => { product.soldOut = true; });
  assert.match(render(), /이번 모집은 마감/);
  products.splice(0);
  assert.match(render(), /다음 신청을 준비/);
  assert.doesNotMatch(render(), /이번 모집은 마감/);
});

type MutationResult = { ok: boolean; message: string };

function loadStatusAction(options: {
  denied?: boolean;
  missingProduct?: boolean;
  productError?: boolean;
  missingScope?: boolean;
  scopeError?: boolean;
  updateError?: boolean;
} = {}) {
  const writes: unknown[] = [];
  const paths: string[] = [];
  let clients = 0;
  const subject = loadModule<{ updateProductStatusAction: (id: string, status: string) => Promise<MutationResult> }>(
    "app/admin/products/actions.ts",
    {
      "@/lib/admin/auth": { requireAdmin: async () => { if (options.denied) throw new Error("denied"); } },
      "@/lib/validation/safe-input": { isUuid: (value: string) => value === productId },
      "next/cache": { revalidatePath: (path: string) => paths.push(path) },
      "@/lib/supabase/server": { createClient: async () => {
        clients++;
        return { from: (table: string) => {
          let updating = false;
          const query = {
            select: () => query,
            eq: () => query,
            update: (values: unknown) => { updating = true; writes.push(values); return query; },
            maybeSingle: async () => {
              if (updating) return options.updateError ? { data: null, error: { message: "write denied" } } : { data: { id: productId, slug: "sns-monetization-feedback" }, error: null };
              if (table === "product_course_scopes") return { data: options.missingScope ? null : { product_id: productId }, error: options.scopeError ? { message: "offline" } : null };
              return { data: options.missingProduct ? null : { product_type: "course" }, error: options.productError ? { message: "offline" } : null };
            },
          };
          return query;
        } };
      } },
    }
  );
  return { action: subject.updateProductStatusAction, writes, paths, clientCount: () => clients };
}

test("권한 없는 직접 상태 변경 요청은 DB에 도달하지 않는다", async () => {
  const subject = loadStatusAction({ denied: true });
  await assert.rejects(subject.action(productId, "sold_out"), /denied/);
  assert.equal(subject.clientCount(), 0);
  assert.equal(subject.writes.length, 0);
});

test("상품 ID와 상태 검증 실패는 저장과 재검증을 하지 않는다", async () => {
  const subject = loadStatusAction();
  assert.equal((await subject.action("bad-id", "sold_out")).ok, false);
  assert.equal((await subject.action(productId, "bad-status")).ok, false);
  assert.equal(subject.clientCount(), 0);
  assert.equal(subject.paths.length, 0);
});

test("판매 시작은 상품 조회 장애·누락·강의 연결 누락 때 실패한다", async () => {
  for (const options of [{ missingProduct: true }, { productError: true }, { missingScope: true }, { scopeError: true }]) {
    const subject = loadStatusAction(options);
    assert.equal((await subject.action(productId, "active")).ok, false);
    assert.equal(subject.writes.length, 0);
    assert.equal(subject.paths.length, 0);
  }
});

test("저장 실패는 성공으로 응답하거나 캐시를 갱신하지 않는다", async () => {
  const subject = loadStatusAction({ updateError: true });
  assert.equal((await subject.action(productId, "active")).ok, false);
  assert.equal(subject.paths.length, 0);
});

test("판매 시작과 품절은 status만 저장하고 모든 등급 비교 경로를 갱신한다", async () => {
  for (const status of ["active", "sold_out"]) {
    const subject = loadStatusAction();
    assert.equal((await subject.action(productId, status)).ok, true);
    assert.equal(JSON.stringify(subject.writes), JSON.stringify([{ status }]));
    for (const path of ["/admin/products", "/", "/courses", "/checkout", ...plans.membershipPlanDefinitions.map((plan) => `/courses/${plan.slug}`)]) {
      assert.ok(subject.paths.includes(path), path);
    }
  }
});

test("등급별 저장 실패와 네트워크 장애는 저장된 품절 상태를 판매 중으로 바꾸지 않는다", async () => {
  type SaveState = { status: "idle" | "success" | "error"; message: string };
  const saveCallbacks: Array<(previous: SaveState, formData: FormData) => Promise<SaveState>> = [];
  let state: SaveState = { status: "idle", message: "" };
  let throws = false;
  const changedIds: string[] = [];
  const subject = loadModule<{ default: React.ComponentType<{ products: AdminProduct[]; databaseReady: boolean }> }>(
    "components/admin/AdminMembershipSales.tsx",
    {
      react: { useActionState: (save: (previous: SaveState, formData: FormData) => Promise<SaveState>) => { saveCallbacks.push(save); return [state, () => {}, false]; } },
      "@/app/admin/products/actions": { updateProductStatusAction: async (id: string) => { changedIds.push(id); if (throws) throw new Error("offline"); return { ok: false, message: "permission denied" }; } },
    }
  );
  const products = plans.membershipPlanDefinitions.map((plan, index) => ({
    id: `tier-${index}`, slug: plan.slug, productType: "course", priceKrw: plan.fallbackPriceKrw, source: "database", status: "sold_out",
  } as AdminProduct));
  const render = () => renderToStaticMarkup(React.createElement(subject.default, { products, databaseReady: true }));
  render();
  const formData = new FormData();
  formData.set("status", "active");
  state = await saveCallbacks[1](state, formData);
  assert.equal(state.status, "error");
  const markup = render();
  assert.deepEqual(changedIds, ["tier-1"]);
  assert.equal((markup.match(/현재 상태: <strong>품절<\/strong>/g) ?? []).length, 3);
  assert.match(markup, /role="alert">저장 실패/);
  throws = true;
  state = await saveCallbacks[1](state, formData);
  assert.equal(state.status, "error");
  assert.match(render(), /저장 결과를 확인하지 못했습니다/);
});

test("관리자 등급별 저장 완료·저장 중·상품 누락 상태를 표시한다", async () => {
  type SaveState = { status: "idle" | "success" | "error"; message: string };
  const saves: Array<(previous: SaveState, formData: FormData) => Promise<SaveState>> = [];
  let state: SaveState = { status: "idle", message: "" };
  let pending = false;
  const subject = loadModule<{ default: React.ComponentType<{ products: AdminProduct[]; databaseReady: boolean }> }>(
    "components/admin/AdminMembershipSales.tsx",
    {
      react: { useActionState: (save: (previous: SaveState, formData: FormData) => Promise<SaveState>) => { saves.push(save); return [state, () => {}, pending]; } },
      "@/app/admin/products/actions": { updateProductStatusAction: async () => ({ ok: true, message: "품절 상태로 변경했습니다." }) },
    }
  );
  const products = [{ id: productId, slug: plans.membershipPlanDefinitions[0].slug, productType: "course", priceKrw: 930000, source: "database", status: "draft" } as AdminProduct];
  const render = (databaseReady = true) => renderToStaticMarkup(React.createElement(subject.default, { products, databaseReady }));
  const markup = render();
  assert.match(markup, /현재 상태: <strong>작성 중<\/strong>/);
  assert.equal((markup.match(/상품 미등록/g) ?? []).length, 2);
  assert.equal((markup.match(/disabled=""/g) ?? []).length, 4);
  const formData = new FormData();
  formData.set("status", "sold_out");
  state = await saves[0](state, formData);
  assert.equal(state.status, "success");
  assert.match(render(), /role="status">저장 완료: 품절/);
  pending = true;
  const pendingMarkup = render();
  assert.match(pendingMarkup, /aria-busy="true"/);
  assert.equal((pendingMarkup.match(/disabled=""/g) ?? []).length, 6);
  assert.match(pendingMarkup, /저장 중…/);
  pending = false;
  assert.equal((render(false).match(/disabled=""/g) ?? []).length, 6);
});

test("직접 결제 URL과 주문 RPC의 판매 상태 경계는 소스에서 유지된다", () => {
  const checkout = readFileSync(new URL("../src/app/checkout/page.tsx", import.meta.url), "utf8");
  const paidSql = readFileSync(new URL("../supabase/migrations/20261004160000_harden_payment_recovery.sql", import.meta.url), "utf8");
  const freeSql = readFileSync(new URL("../supabase/migrations/20260716120000_create_orders.sql", import.meta.url), "utf8");
  const paidCreation = paidSql.split("create or replace function public.create_toss_payment_order(")[1]?.split("$$;")[0];
  const freeCreation = freeSql.split("create or replace function public.claim_free_product(")[1]?.split("$$;")[0];
  assert.ok(paidCreation);
  assert.ok(freeCreation);
  assert.match(checkout, /: product\.soldOut \? \(/);
  assert.match(paidCreation, /auth\.uid\(\)/);
  assert.match(paidCreation, /status = 'active'/);
  assert.match(paidCreation, /raise exception 'active product not found'/);
  assert.match(freeCreation, /auth\.uid\(\)/);
  assert.match(freeCreation, /status = 'active'/);
});
