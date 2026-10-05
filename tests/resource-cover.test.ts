import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as pricing from "../src/lib/store/pricing.ts";
import * as availability from "../src/lib/store/sale-availability.ts";
import type { SaleDetail } from "../src/lib/store/public-sale.ts";
import type { ShelfPageProps } from "../src/components/store/ShelfPage.tsx";

const coverPath = "/assets/resources/reverse-proposal-template-cover.png";
const emptyComponent = () => null;

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function loadComponent<Props>(path: string, dependencies: Record<string, unknown> = {}) {
  const exports: { default?: React.ComponentType<Props> } = {};
  const shared: Record<string, unknown> = {
    "react/jsx-runtime": jsxRuntime,
    "next/image": ({ src, alt, className }: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement("img", { src, alt, className }),
    "next/link": (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement("a", props),
    "@/components/layout/SiteFooter": emptyComponent,
    "@/components/layout/SiteHeader": emptyComponent,
    "@/lib/store/pricing": pricing,
    "@/lib/store/sale-availability": availability,
    "./CoursePurchasePolicy": emptyComponent,
    "./ConsultingDetail": emptyComponent,
    "./CourseEnrollmentPicker": emptyComponent,
    "./ResourceDetail": emptyComponent,
    "./ResourceViewer": emptyComponent,
    ...dependencies,
  };
  runInNewContext(ts.transpileModule(source(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText, {
    exports,
    require: (name: string) => {
      if (Object.hasOwn(shared, name)) return shared[name];
      if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports.default!;
}

const resource: SaleDetail = {
  key: "free-resource", productType: "ebook", slug: "small-account-ebook",
  title: "역제안 템플릿", summary: "기존 자료 소개", priceKrw: 0, listPriceKrw: null,
  soldOut: false, thumbnailSrc: coverPath, detailHref: "/library/small-account-ebook",
  visualLabel: "YIYUM FREE LIBRARY", visualCaption: "이윰", eyebrow: "FREE · LIBRARY", metaItems: [],
  checkoutHref: "", accessLabel: "기간 제한 없이 이용", facts: [], course: null,
  ctaLabel: "바로 읽어보기", ctaHref: "#resource-viewer", unlockHref: "/login", unlockLabel: "로그인",
  detailParagraphs: ["기존 본문 안내"], detailItems: [], hasFile: true,
  pageView: { pages: [{ pageNumber: 1, imageUrl: "/original-page.png", width: 1080, height: 1440, unlocked: true }], totalCount: 1, unlockedCount: 1, lockedCount: 0 },
  headerActive: "library", breadcrumbHref: "/library", breadcrumbLabel: "무료자료",
};

const shelf: ShelfPageProps = {
  navKey: "library", currentPath: "/library", eyebrow: "FREE", title: "무료자료", lead: "자료 안내",
  items: [resource], countLabel: "FREE", emptyTitle: "준비 중", emptyBody: "준비 중",
};

test("uploaded cover is a 1080 by 1440 PNG served as a public asset", () => {
  const bytes = readFileSync(new URL(`../public${coverPath}`, import.meta.url));
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(bytes.readUInt32BE(16), 1080);
  assert.equal(bytes.readUInt32BE(20), 1440);
});

test("resource shelf shows the supplied cover and database title without overlapping decorations", () => {
  const Component = loadComponent<ShelfPageProps>("src/components/store/ShelfPage.tsx");
  const markup = renderToStaticMarkup(React.createElement(Component, shelf));
  assert.ok(markup.includes(`src="${coverPath}"`));
  assert.match(markup, /alt="역제안 템플릿"/);
  assert.match(markup, /class="image"/);
  assert.doesNotMatch(markup, /class="(?:imageShade|badge|placeholder)"/);
  assert.match(markup, /href="\/library\/small-account-ebook"/);
  const placeholder = renderToStaticMarkup(React.createElement(Component, { ...shelf, items: [{ ...resource, thumbnailSrc: null }] }));
  assert.match(placeholder, /class="placeholder"/);
  assert.match(placeholder, /class="badge"/);
});

test("resource detail uses the full portrait cover and preserves original reader data", () => {
  let readerData: unknown;
  const Component = loadComponent<{ item: SaleDetail }>("src/components/store/SaleDetailPage.tsx", {
    "./ResourceViewer": (props: unknown) => { readerData = props; return null; },
  });
  const markup = renderToStaticMarkup(React.createElement(Component, { item: resource }));
  assert.match(markup, /class="visual resourceVisual"/);
  assert.match(markup, /class="courseImage resourceImage"/);
  assert.match(markup, /alt="역제안 템플릿"/);
  assert.doesNotMatch(markup, /class="(?:imageShade|imageLabel|instructor)"/);
  assert.equal((readerData as { view: unknown }).view, resource.pageView);
  assert.deepEqual(JSON.parse(JSON.stringify(readerData)), { view: resource.pageView, unlockHref: "/login", unlockLabel: "로그인", free: true });
  assert.match(markup, /href="#resource-viewer"/);
});

test("course covers and resource placeholders retain their existing treatment", () => {
  const Component = loadComponent<{ item: SaleDetail }>("src/components/store/SaleDetailPage.tsx");
  for (const item of [{ ...resource, productType: "course" as const }, { ...resource, thumbnailSrc: null }]) {
    const markup = renderToStaticMarkup(React.createElement(Component, { item }));
    assert.doesNotMatch(markup, /resourceVisual|resourceImage/);
    assert.match(markup, /class="imageLabel"/);
    assert.match(markup, /class="instructor"/);
  }
});

test("portrait styles override mobile landscape cropping without changing course images", () => {
  const detailCss = source("src/components/store/SaleDetailPage.module.css");
  assert.match(detailCss, /\.visual\.resourceVisual\s*\{[^}]*min-height:\s*0;[^}]*aspect-ratio:\s*3\s*\/\s*4;[^}]*align-self:\s*start;/);
  assert.match(detailCss, /\.courseImage\.resourceImage\s*\{[^}]*object-fit:\s*contain;/);
  assert.match(detailCss, /\.courseImage\s*\{[^}]*object-fit:\s*cover;/);
  assert.match(source("src/components/store/ShelfPage.module.css"), /\.image\s*\{[^}]*object-fit:\s*contain;/);
});

test("cover migration changes only the approved free resource title and thumbnail", () => {
  const migration = source("supabase/migrations/20261005110000_set_free_resource_cover.sql");
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(migration, /set title = '역제안 템플릿',\s+thumbnail_path = '\/assets\/resources\/reverse-proposal-template-cover\.png'/);
  assert.match(migration, /where slug = 'small-account-ebook'\s+and product_type = 'ebook'\s+and price_krw = 0/);
  assert.match(migration, /and title = '무료 자료'\s+and thumbnail_path is null/);
  assert.doesNotMatch(migration, /\b(delete|insert|drop|file_path|product_pages|product_entitlements)\b/i);
  assert.doesNotMatch(migration.split("where")[0], /\b(price_krw|status|detail_body|summary)\s*=/i);
});
