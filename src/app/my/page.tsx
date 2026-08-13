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
  buildConsultingLibraryItem,
  buildEbookLibraryItem,
  buildCourseLibraryItem,
} from "@/lib/my-class/library-data";
import type { LibraryItem } from "@/lib/my-class/types";
import { loadMyActiveProductLibrary } from "@/lib/store/entitlements";
import { loadMyCourseCatalog } from "@/lib/store/public-course-catalog";
import { getVerifiedIdentity } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";
import styles from "./my.module.css";

export const metadata: Metadata = {
  title: "마이 클래스 | 이윰 클래스",
  description: "구매한 VOD 강의와 전자책, 수강 진도를 확인하세요.",
};

export default async function MyPage() {
  const supabase = await createClient();
  const identity = await getVerifiedIdentity(supabase);

  if (!identity) {
    redirect("/login?next=/my");
  }

  const meta = identity.metadata;
  const rawDisplayName = meta.nickname ?? meta.name ?? meta.full_name;
  const displayName =
    typeof rawDisplayName === "string" && rawDisplayName.trim()
      ? rawDisplayName.trim()
      : "회원";
  const [entitlementResult, catalog] = await Promise.all([
    loadMyActiveProductLibrary(supabase),
    loadMyCourseCatalog(supabase),
  ]);
  const entitlements = entitlementResult.available
    ? entitlementResult.entitlements
    : [];
  const entitledCourseSlugs = new Set(
    entitlements
      .filter((entitlement) => entitlement.productType === "course")
      .map((entitlement) => entitlement.productSlug)
  );
  const items: LibraryItem[] = await Promise.all(
    catalog.filter((catalogItem) => entitledCourseSlugs.has(catalogItem.slug)).map(async (catalogItem) => {
      const course = catalogItem.classroomCourse ?? catalogItem.course;
      const progress = catalogItem.contentReady
        ? await loadCourseProgress(supabase, course).then((result) =>
            result.available ? result.progress : createEmptyCourseProgress(course)
          )
        : createEmptyCourseProgress(course);

      return buildCourseLibraryItem(course, progress, {
        productSlug: catalogItem.slug,
        description: catalogItem.summary,
        accessLabel: catalogItem.accessLabel,
        contentReady: catalogItem.contentReady,
      });
    })
  );

  items.push(
    ...entitlements
      .filter((entitlement) => entitlement.productType === "consulting")
      .map((entitlement) =>
        buildConsultingLibraryItem({
          slug: entitlement.productSlug,
          title: entitlement.title,
          description:
            entitlement.summary ||
            "결제해 주셔서 감사합니다. 카카오톡과 이메일로 보내드린 설문 폼을 작성해 주시면 48시간 이내로 연락드릴게요.",
          accessLabel: formatLibraryAccessLabel(
            entitlement.expiresAt,
            entitlement.accessPeriodDays
          ),
        })
      )
  );

  items.push(
    ...entitlements
      .filter((entitlement) => entitlement.productType === "ebook")
      .map((entitlement) =>
        buildEbookLibraryItem({
          slug: entitlement.productSlug,
          title: entitlement.title,
          description: entitlement.summary || "받아 두신 자료입니다.",
          hasFile: entitlement.hasFile,
          accessLabel: formatLibraryAccessLabel(
            entitlement.expiresAt,
            entitlement.accessPeriodDays
          ),
        })
      )
  );

  return (
    <div className={styles.page}>
      <AccountHeader active="classes" displayName={displayName} />

      <main className={styles.main}>
        <MyClassLibrary
          displayName={displayName}
          items={items}
          entitlementLoadError={
            entitlementResult.available
              ? null
              : entitlementResult.errorMessage
          }
        />
      </main>

      <SiteFooter variant="compact" />
    </div>
  );
}

function formatLibraryAccessLabel(expiresAt: string | null, accessPeriodDays: number | null) {
  if (expiresAt) {
    return `${new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(expiresAt))}까지`;
  }
  return accessPeriodDays === null ? "기간 제한 없이 이용" : `${accessPeriodDays}일 이용`;
}
