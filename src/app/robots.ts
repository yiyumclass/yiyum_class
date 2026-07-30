import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // 비공개·기능 영역은 크롤링 대상에서 제외한다.
      disallow: ["/admin", "/my", "/account", "/api", "/checkout", "/auth"],
    },
    sitemap: new URL("/sitemap.xml", SITE_URL).toString(),
  };
}
