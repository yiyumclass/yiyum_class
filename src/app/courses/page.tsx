import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import SiteFooter from "@/components/layout/SiteFooter";
import SiteHeader from "@/components/layout/SiteHeader";
import {
  loadPublicCourseCatalog,
  type PublicCourseCatalogItem,
} from "@/lib/store/public-course-catalog";
import styles from "./courses.module.css";

export const metadata: Metadata = {
  title: "강의 둘러보기 | 이윰 클래스",
  description: "이윰의 SNS 수익화 VOD 클래스를 살펴보고 나에게 맞는 강의를 선택하세요.",
};

export default async function CoursesPage() {
  const catalog = await loadPublicCourseCatalog();

  return (
    <div className={styles.page}>
      <SiteHeader active="courses" currentPath="/courses" />

      <main>
        <section className={styles.hero} aria-labelledby="courses-title">
          <div className={styles.heroInner}>
            <div>
              <span className={styles.eyebrow}>YIYUM COURSES</span>
              <h1 id="courses-title" className="serif">
                클래스 둘러보기
              </h1>
            </div>
            <p>
              계정을 키우는 방법부터 그 성장을 수익으로 연결하는 과정까지,
              필요한 클래스를 골라 시작해 보세요.
            </p>
          </div>
        </section>

        <section className={styles.catalog} aria-labelledby="catalog-title">
          <div className={styles.sectionHeading}>
            <div>
              <span className={`serif ${styles.sectionNumber}`}>01</span>
              <h2 id="catalog-title" className="serif">전체 강의</h2>
            </div>
            <span className={styles.courseCount}>
              {String(catalog.length).padStart(2, "0")} COURSE
            </span>
          </div>

          {catalog.length > 0 ? (
            <div className={styles.courseGrid}>
              {catalog.map((item, index) => (
                <CourseCard key={item.productId} item={item} priority={index < 3} />
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <strong>현재 판매 중인 강의가 없습니다.</strong>
              <p>새로운 클래스를 준비하고 있어요. 조금만 기다려 주세요.</p>
            </div>
          )}
        </section>

        <section className={styles.guide} aria-labelledby="guide-title">
          <div className={styles.guideHeading}>
            <span>LEARNING GUIDE</span>
            <h2 id="guide-title" className="serif">수강 방식</h2>
          </div>
          <div className={styles.guideItems}>
            <GuideItem number="01" title="원하는 시간에 재생" description="결제 후 마이 클래스에서 바로 시작할 수 있어요." />
            <GuideItem number="02" title="진도 자동 저장" description="마지막으로 본 위치와 완료한 차시를 자동으로 기록해요." />
            <GuideItem number="03" title="문의 지원" description="수강과 결제 문의는 카카오톡 채널 또는 이메일로 도와드려요." />
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function CourseCard({
  item,
  priority,
}: {
  item: PublicCourseCatalogItem;
  priority: boolean;
}) {
  const lessons = item.course.sections.flatMap((section) => section.lessons);
  const totalDurationSeconds = lessons.reduce(
    (total, lesson) => total + lesson.durationSeconds,
    0
  );

  return (
    <article className={styles.courseCard}>
      <Link
        href={item.detailHref}
        className={styles.courseVisual}
        aria-label={`${item.title} 자세히 보기`}
      >
        {item.thumbnailSrc ? (
          <>
            <Image
              src={item.thumbnailSrc}
              alt={`${item.course.instructor || "이윰"}의 ${item.title}`}
              fill
              priority={priority}
              sizes="(max-width: 680px) 100vw, (max-width: 1020px) 50vw, 33vw"
              className={styles.courseImage}
            />
            <div className={styles.imageShade} aria-hidden="true" />
          </>
        ) : (
          <div className={styles.visualPlaceholder} aria-hidden="true">
            <span>YIYUM CLASS</span>
            <strong className="serif">{item.title.slice(0, 1)}</strong>
          </div>
        )}
        <span className={styles.vodBadge}>VOD CLASS</span>
        <span className={styles.instructor}>
          {item.course.instructor || item.title}
        </span>
      </Link>

      <div className={styles.courseBody}>
        <span className={styles.category}>SNS · MONETIZATION</span>
        <h3 className="serif">
          <Link href={item.detailHref}>{item.title}</Link>
        </h3>
        <p className={styles.summary}>{item.summary}</p>

        <div className={styles.courseMeta} aria-label="강의 정보">
          {item.outlineReady ? (
            <>
              <span>{lessons.length}강</span>
              <span>{formatCourseDuration(totalDurationSeconds)}</span>
            </>
          ) : (
            <span>커리큘럼 준비 중</span>
          )}
          <span>{item.accessLabel}</span>
        </div>

        <div className={styles.cardFooter}>
          <div className={styles.price}>
            <span>부가세 포함</span>
            <strong className="serif">
              {formatPrice(item.priceKrw)}<small>원</small>
            </strong>
          </div>
          <Link href={item.detailHref} className={styles.detailAction}>
            강의 보기 <ArrowIcon />
          </Link>
        </div>
      </div>
    </article>
  );
}

function GuideItem({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <article>
      <span className={`serif ${styles.guideNumber}`}>{number}</span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </article>
  );
}

function formatCourseDuration(seconds: number) {
  if (seconds <= 0) return "재생 시간 안내 예정";
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat("ko-KR").format(price);
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.5 10h12M11 5l5 5-5 5" />
    </svg>
  );
}
