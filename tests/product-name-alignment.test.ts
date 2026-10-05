import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as membershipPlans from "../src/lib/store/membership-plans.ts";
import * as pricing from "../src/lib/store/pricing.ts";
import type { MembershipProductOption } from "../src/components/store/CourseEnrollmentPicker";
import type { PublicCourseCatalogItem } from "../src/lib/store/public-course-catalog";
import type { SaleCard, SaleDetail } from "../src/lib/store/public-sale";

function sourceFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function loadModule<Module>(path: string, dependencies: Record<string, unknown>) {
  const exports = {};
  const compiled = ts.transpileModule(sourceFile(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  runInNewContext(compiled.outputText, {
    exports,
    document: { body: {} },
    require: (name: string) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports as Module;
}

function renderPicker(products: MembershipProductOption[]) {
  const { CourseEnrollmentProvider } = loadModule<{
    CourseEnrollmentProvider: React.ComponentType<{
      products: MembershipProductOption[];
      children?: React.ReactNode;
    }>;
  }>("src/components/store/CourseEnrollmentPicker.tsx", {
    react: { ...React, useState: () => [true, () => {}] },
    "react/jsx-runtime": jsxRuntime,
    "react-dom": { createPortal: (children: React.ReactNode) => children },
    "next/link": {
      default: (props: React.ComponentProps<"a">) => React.createElement("a", props),
    },
    "@/lib/store/membership-plans": membershipPlans,
    "@/lib/store/pricing": pricing,
    "./CourseEnrollmentPicker.module.css": { default: {} },
  });
  return renderToStaticMarkup(React.createElement(CourseEnrollmentProvider, { products }));
}

test("수강 방식 선택의 제목·접근성 이름·선택 버튼은 관리자 상품명을 따른다", () => {
  const products = membershipPlans.membershipPlanDefinitions.map((plan) => ({
    slug: plan.slug,
    title: `관리자 변경 상품 ${plan.order}`,
    priceKrw: plan.fallbackPriceKrw,
    soldOut: false,
    checkoutHref: `/checkout?product=${plan.slug}`,
  }));
  const markup = renderPicker(products);

  for (const [index, product] of products.entries()) {
    const plan = membershipPlans.membershipPlanDefinitions[index];
    assert.ok(markup.includes(`aria-label="${plan.order}번 ${plan.icon} ${product.title}"`));
    assert.ok(markup.includes(`>${product.title}</span>`));
    assert.ok(markup.includes(`aria-label="${plan.icon} ${product.title} 포함 혜택"`));
    assert.ok(markup.includes(`${product.title} 선택`));
    assert.ok(markup.includes(`href="${product.checkoutHref}"`));
    assert.ok(markup.includes(`${pricing.formatKrw(product.priceKrw)}원`));
    assert.ok(!markup.includes(plan.title));
  }
});

test("품절 상품도 DB 이름을 표시하고 누락 상품만 기본 이름으로 비활성 표시한다", () => {
  const [plan] = membershipPlans.membershipPlanDefinitions;
  const markup = renderPicker([{
    slug: plan.slug,
    title: "관리자 지정 마감 클래스",
    priceKrw: plan.fallbackPriceKrw,
    soldOut: true,
    checkoutHref: `/checkout?product=${plan.slug}`,
  }]);

  assert.ok(markup.includes("관리자 지정 마감 클래스"));
  assert.ok(markup.includes("지금은 신청 마감"));
  assert.ok(markup.includes("판매 준비 중"));
  assert.ok(markup.includes(membershipPlans.membershipPlanDefinitions[1].title));
  assert.ok(markup.includes(membershipPlans.membershipPlanDefinitions[2].title));
  assert.doesNotMatch(markup, /href="\/checkout/);
});

function courseProduct(slug: string, title: string): PublicCourseCatalogItem {
  return {
    productId: `product-${slug}`,
    slug,
    title,
    summary: "강의 소개",
    priceKrw: 930000,
    listPriceKrw: null,
    soldOut: false,
    accessPeriodDays: 365,
    accessLabel: "365일",
    thumbnailSrc: null,
    detailHref: `/courses/${slug}`,
    checkoutHref: `/checkout?product=${slug}`,
    course: {
      slug: "sns-monetization",
      title: "이윰 SNS 수익화 클래스",
      shortTitle: "SNS 클래스",
      description: "공통 강의",
      instructor: "이윰",
      posterSrc: "",
      sections: [],
    },
    classroomCourse: null,
    outlineReady: true,
    contentReady: false,
    source: "database",
  };
}

test("공통 강의 소개에는 원본 강의명을 쓰되 개별 판매 상품명은 유지한다", async () => {
  const products = [
    ...membershipPlans.membershipPlanDefinitions.map((plan) => courseProduct(plan.slug, plan.title)),
    courseProduct("other-course", "별도 판매 상품"),
  ];
  const sale = loadModule<{
    loadPublicSaleCatalog: () => Promise<SaleCard[]>;
    loadPublicSaleDetail: (slug: string) => Promise<SaleDetail>;
  }>("src/lib/store/public-sale.ts", {
    "server-only": {},
    react: { cache: (callback: unknown) => callback },
    "@/lib/store/consulting-copy": {},
    "@/lib/store/product-pages": {},
    "@/lib/store/public-detail-items": {},
    "@/lib/store/membership-plans": membershipPlans,
    "@/lib/store/public-course-catalog": {
      loadPublicCourseCatalog: async () => products,
      loadPublicCourseBySlug: async (slug: string) => products.find((product) => product.slug === slug),
    },
    "@/lib/store/public-products": { loadPublicProductsByType: async () => [] },
  });

  const catalog = await sale.loadPublicSaleCatalog();
  assert.equal(catalog.length, 2);
  assert.equal(catalog[0].title, "이윰 SNS 수익화 클래스");
  assert.equal(catalog[1].title, "별도 판매 상품");
  for (const plan of membershipPlans.membershipPlanDefinitions) {
    const detail = await sale.loadPublicSaleDetail(plan.slug);
    assert.equal(detail.title, "이윰 SNS 수익화 클래스");
    assert.equal(detail.course?.title, plan.title);
    assert.equal(detail.checkoutHref, `/checkout?product=${plan.slug}`);
  }
  assert.equal((await sale.loadPublicSaleDetail("other-course")).title, "별도 판매 상품");
});

test("홈과 상세 페이지 모두 DB 상품명을 수강 방식 선택창에 전달한다", () => {
  const home = sourceFile("src/app/page.tsx");
  const detail = sourceFile("src/app/courses/[slug]/page.tsx");

  assert.match(home, /slug: item\.slug,\s+title: item\.title,/);
  assert.match(detail, /slug: course\.slug,\s+title: course\.title,/);
  assert.match(home, /const courseTitle = featuredItem\?\.course\.title/);
});

test("상품명 마이그레이션은 세 상품의 기존 이름만 바꾸고 다른 필드는 유지한다", () => {
  const migration = sourceFile("supabase/migrations/20261005060000_align_membership_product_titles.sql");
  const previousTitles = ["이윰 SNS 수익화 클래스", "피드백 클래스", "초밀착 클래스"];

  for (const [index, plan] of membershipPlans.membershipPlanDefinitions.entries()) {
    assert.ok(migration.includes(`('${plan.slug}', '${previousTitles[index]}', '${plan.title}')`));
  }
  assert.match(migration, /set title = names\.title\s+from/i);
  assert.match(migration, /product\.slug = names\.slug/);
  assert.match(migration, /product\.product_type = 'course'/);
  assert.match(migration, /product\.title = names\.previous_title/);
  assert.equal((migration.match(/\bupdate\b/gi) ?? []).length, 1);
  assert.doesNotMatch(migration, /\b(insert|delete|drop|alter|create)\b/i);
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/i);
});
