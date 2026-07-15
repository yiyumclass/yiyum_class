import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteFooter from "@/components/layout/SiteFooter";
import SiteHeader from "@/components/layout/SiteHeader";
import { loadPublicCourseBySlug } from "@/lib/store/public-course-catalog";
import styles from "./course-detail.module.css";

type CourseDetailPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: CourseDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const item = await loadPublicCourseBySlug(slug);

  if (!item) return { title: "강의를 찾을 수 없습니다 | 이윰 클래스" };

  return {
    title: `${item.title} | 이윰 클래스`,
    description: item.summary,
  };
}

export default async function CourseDetailPage({ params }: CourseDetailPageProps) {
  const { slug } = await params;
  const item = await loadPublicCourseBySlug(slug);
  if (!item) notFound();

  const lessons = item.course.sections.flatMap((section) => section.lessons);
  const totalDurationSeconds = lessons.reduce(
    (total, lesson) => total + lesson.durationSeconds,
    0
  );

  return (
    <div className={styles.page}>
      <SiteHeader active="courses" currentPath={`/courses/${item.slug}`} />

      <main>
        <div className={styles.breadcrumb}>
          <Link href="/courses">강의</Link>
          <span aria-hidden="true">/</span>
          <span>{item.title}</span>
        </div>

        <section className={styles.hero} aria-labelledby="course-title">
          <div className={styles.visual}>
            {item.thumbnailSrc ? (
              <>
                <Image
                  src={item.thumbnailSrc}
                  alt={`${item.course.instructor || "이윰"}의 ${item.title}`}
                  fill
                  priority
                  sizes="(max-width: 760px) 100vw, 43vw"
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
            <span className={styles.imageLabel}>YIYUM VOD CLASS</span>
            <span className={styles.instructor}>
              {item.course.instructor || item.title}
            </span>
          </div>

          <div className={styles.heroContent}>
            <span className={styles.eyebrow}>SNS · MONETIZATION</span>
            <h1 id="course-title" className="serif">{item.title}</h1>
            <p className={styles.summary}>{item.summary}</p>

            <dl className={styles.facts}>
              <div>
                <dt>커리큘럼</dt>
                <dd>
                  {item.outlineReady
                    ? `${item.course.sections.length}개 챕터 · ${lessons.length}강`
                    : "준비 중"}
                </dd>
              </div>
              <div>
                <dt>총 재생 시간</dt>
                <dd>{item.outlineReady ? formatCourseDuration(totalDurationSeconds) : "안내 예정"}</dd>
              </div>
              <div>
                <dt>수강 기간</dt>
                <dd>{item.accessLabel}</dd>
              </div>
              <div>
                <dt>수강 방식</dt>
                <dd>마이 클래스에서 VOD 재생</dd>
              </div>
            </dl>

            <div className={styles.purchaseArea}>
              <div className={styles.price}>
                <span>수강료 · 부가세 포함</span>
                <strong className="serif">
                  {formatPrice(item.priceKrw)}<small>원</small>
                </strong>
              </div>
              <div className={styles.actions}>
                <Link href={item.checkoutHref} className={styles.primaryAction}>
                  수강 신청 <ArrowIcon />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section
          id="curriculum"
          className={styles.curriculum}
          aria-labelledby="curriculum-title"
        >
          <div className={styles.curriculumHeading}>
            <div>
              <span>CURRICULUM</span>
              <h2 id="curriculum-title" className="serif">강의 구성</h2>
            </div>
            <p>
              {item.outlineReady
                ? `${item.course.sections.length}개 챕터 · 총 ${lessons.length}강`
                : "상세 커리큘럼 준비 중"}
            </p>
          </div>

          {item.course.sections.length > 0 ? (
            <div className={styles.sectionList}>
              {item.course.sections.map((section, sectionIndex) => (
                <details key={section.id} open={sectionIndex === 0}>
                  <summary>
                    <span className={`serif ${styles.sectionNumber}`}>
                      {String(sectionIndex + 1).padStart(2, "0")}
                    </span>
                    <span className={styles.sectionTitle}>
                      <strong>{section.title}</strong>
                      <small>{section.lessons.length}강</small>
                    </span>
                    <ChevronIcon />
                  </summary>
                  <div className={styles.sectionBody}>
                    {section.description && <p>{section.description}</p>}
                    <ol>
                      {section.lessons.map((lesson, lessonIndex) => (
                        <li key={lesson.id}>
                          <span>{String(lessonIndex + 1).padStart(2, "0")}</span>
                          <strong>{lesson.title}</strong>
                          <small>{formatLessonDuration(lesson.durationSeconds)}</small>
                        </li>
                      ))}
                    </ol>
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <div className={styles.curriculumEmpty}>상세 커리큘럼을 준비하고 있습니다.</div>
          )}
        </section>

        <section className={styles.bottomCta}>
          <div>
            <span>READY TO START?</span>
            <h2 className="serif">내 속도에 맞춰 시작해 보세요.</h2>
          </div>
          <div>
            <strong className="serif">{formatPrice(item.priceKrw)}원</strong>
            <Link href={item.checkoutHref}>수강 신청 <ArrowIcon /></Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function formatCourseDuration(seconds: number) {
  if (seconds <= 0) return "안내 예정";
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`;
}

function formatLessonDuration(seconds: number) {
  if (seconds <= 0) return "-";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
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

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5 7.5 5 5 5-5" />
    </svg>
  );
}
