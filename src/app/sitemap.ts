import type { MetadataRoute } from "next";
import { loadPublicCourseCatalog } from "@/lib/store/public-course-catalog";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// 공개 정적 라우트. admin/*, /my, /account, /login, /signup, /checkout,
// /learn 등 비공개·기능 페이지는 색인 대상이 아니므로 제외한다.
const STATIC_ROUTES: ReadonlyArray<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/courses", changeFrequency: "weekly", priority: 0.9 },
  { path: "/sns", changeFrequency: "monthly", priority: 0.6 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.4 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.2 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.2 },
];

function toAbsoluteUrl(path: string) {
  return new URL(path, SITE_URL).toString();
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: toAbsoluteUrl(route.path),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  // 활성 상품 상세 페이지(/courses/[slug])를 DB에서 동적으로 채운다.
  // DB 접근이 실패하더라도 sitemap 전체가 500이 되지 않도록 정적 경로만
  // 반환하는 것을 최소 보장으로 둔다.
  let courseEntries: MetadataRoute.Sitemap = [];
  try {
    const catalog = await loadPublicCourseCatalog();
    courseEntries = catalog.map((item) => ({
      url: toAbsoluteUrl(`/courses/${item.slug}`),
      lastModified,
      changeFrequency: "weekly",
      priority: 0.8,
    }));
  } catch (error) {
    console.error("Failed to build course sitemap entries:", error);
  }

  return [...staticEntries, ...courseEntries];
}
