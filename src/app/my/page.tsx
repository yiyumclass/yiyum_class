import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AccountHeader from "@/components/account/AccountHeader";
import MyClassLibrary from "@/components/my/MyClassLibrary";
import SiteFooter from "@/components/layout/SiteFooter";
import {
  createEmptyCourseProgress,
  loadCourseProgress,
} from "@/lib/learning/progress";
import {
  buildEbookLibraryItem,
  buildCourseLibraryItem,
} from "@/lib/my-class/library-data";
import type { LibraryItem } from "@/lib/my-class/types";
import { loadMyActiveProductEntitlements } from "@/lib/store/entitlements";
import { loadPublicCourseCatalog } from "@/lib/store/public-course-catalog";
import { createClient } from "@/lib/supabase/server";
import styles from "./my.module.css";

export const metadata: Metadata = {
  title: "마이 클래스 | 이윰 클래스",
  description: "구매한 VOD 강의와 전자책, 수강 진도를 확인하세요.",
};

export default async function MyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/my");
  }

  const meta = user.user_metadata ?? {};
  const rawDisplayName = meta.nickname ?? meta.name ?? meta.full_name;
  const displayName =
    typeof rawDisplayName === "string" && rawDisplayName.trim()
      ? rawDisplayName.trim()
      : "회원";
  const entitlements = await loadMyActiveProductEntitlements(supabase);
  const entitlementSlugs = new Set(
    entitlements.map((entitlement) => entitlement.productSlug)
  );
  const catalog = await loadPublicCourseCatalog();
  const items: LibraryItem[] = [];

  for (const catalogItem of catalog) {
    if (!entitlementSlugs.has(catalogItem.slug)) {
      continue;
    }
    const course = catalogItem.classroomCourse ?? catalogItem.course;
    const progress = catalogItem.contentReady
      ? await loadCourseProgress(supabase, course).then((result) =>
          result.available ? result.progress : createEmptyCourseProgress(course)
        )
      : createEmptyCourseProgress(course);
    items.push(
      buildCourseLibraryItem(course, progress, {
        description: catalogItem.summary,
        accessLabel: catalogItem.accessLabel,
        contentReady: catalogItem.contentReady,
      })
    );
  }

  if (entitlementSlugs.has("small-account-ebook")) {
    items.push(buildEbookLibraryItem());
  }

  return (
    <div className={styles.page}>
      <AccountHeader active="classes" displayName={displayName} />

      <main className={styles.main}>
        <MyClassLibrary displayName={displayName} items={items} />
      </main>

      <SiteFooter variant="compact" />
    </div>
  );
}
