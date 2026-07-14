import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import SiteFooter from "@/components/layout/SiteFooter";
import SiteHeader from "@/components/layout/SiteHeader";
import { courses, getCourseBySlug } from "@/lib/learning/catalog";
import { courseProducts, type CourseProduct } from "@/lib/store/course-products";
import styles from "./courses.module.css";

export const metadata: Metadata = {
  title: "강의 둘러보기 | 이윰 클래스",
  description: "이윰의 SNS 수익화 VOD 클래스를 살펴보고 나에게 맞는 강의를 선택하세요.",
};

export default function CoursesPage() {
  const catalog = courseProducts.flatMap((product) => {
    const course = getCourseBySlug(product.courseSlug);
    return course ? [{ product, course }] : [];
  });

  return (
    <div className={styles.page}>
      <SiteHeader active="courses" currentPath="/courses" />

      <main>
        <section className={styles.hero} aria-labelledby="courses-title">
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>YIYUM COURSES</span>
              <h1 id="courses-title" className="serif">
                이윰의 클래스
              </h1>
            </div>

            <div className={styles.heroDescription}>
              <p>
                계정을 키우는 방법뿐 아니라,
                <br />그 성장이 수익으로 이어지는 과정까지 다룹니다.
              </p>
              <span>현재 {catalog.length}개의 클래스를 만나볼 수 있어요.</span>
            </div>
          </div>
        </section>

        <section className={styles.catalog} aria-labelledby="catalog-title">
          <div className={styles.sectionHeading}>
            <div>
              <span className={`serif ${styles.sectionNumber}`}>01</span>
              <h2 id="catalog-title" className="serif">전체 강의</h2>
            </div>
            <span className={styles.courseCount}>{String(catalog.length).padStart(2, "0")} COURSE</span>
          </div>

          <div className={styles.courseList}>
            {catalog.map(({ product, course }, index) => (
              <CourseCard
                key={product.courseSlug}
                product={product}
                course={course}
                index={index}
              />
            ))}
          </div>
        </section>

        <section className={styles.guide} aria-labelledby="guide-title">
          <div className={styles.guideHeading}>
            <span>BEFORE YOU START</span>
            <h2 id="guide-title" className="serif">수강 전에 확인해 주세요</h2>
          </div>
          <div className={styles.guideItems}>
            <GuideItem
              number="01"
              title="원하는 시간에 학습"
              description="결제 후 마이 클래스에서 VOD를 재생하고 마지막 시청 위치부터 이어볼 수 있어요."
            />
            <GuideItem
              number="02"
              title="차시별 진도 저장"
              description="시청 위치와 완료한 강의가 자동으로 기록되어 어디까지 들었는지 바로 확인할 수 있어요."
            />
            <GuideItem
              number="03"
              title="문의가 필요할 때"
              description="수강과 결제에 관한 문의는 카카오톡 채널 또는 이메일로 남겨주세요."
            />
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function CourseCard({
  product,
  course,
  index,
}: {
  product: CourseProduct;
  course: (typeof courses)[number];
  index: number;
}) {
  const lessons = course.sections.flatMap((section) => section.lessons);
  const totalDurationSeconds = lessons.reduce(
    (total, lesson) => total + lesson.durationSeconds,
    0
  );

  return (
    <article className={styles.courseCard}>
      <Link
        href={product.detailHref}
        className={styles.courseVisual}
        aria-label={`${course.title} 자세히 보기`}
      >
        <Image
          src={course.posterSrc}
          alt={`${course.instructor}의 ${course.title}`}
          fill
          priority={index === 0}
          sizes="(max-width: 820px) 100vw, 48vw"
          className={styles.courseImage}
        />
        <div className={styles.imageShade} aria-hidden="true" />
        <div className={styles.visualIndex} aria-hidden="true">
          <span>YIYUM CLASS</span>
          <strong className="serif">{String(index + 1).padStart(2, "0")}</strong>
        </div>
        <div className={styles.visualCaption}>
          <span>{course.instructor}</span>
          <strong>{product.category}</strong>
        </div>
      </Link>

      <div className={styles.courseBody}>
        <div className={styles.courseTopline}>
          <span>{product.category}</span>
          <span>VOD CLASS</span>
        </div>

        <div>
          <h3 className="serif">
            <Link href={product.detailHref}>{course.title}</Link>
          </h3>
          <p className={styles.tagline}>{product.tagline}</p>
        </div>

        <div className={styles.topicList} aria-label="주요 학습 주제">
          {product.topics.map((topic) => <span key={topic}>{topic}</span>)}
        </div>

        <dl className={styles.courseFacts}>
          <div>
            <dt>커리큘럼</dt>
            <dd>{course.sections.length}개 챕터 · {lessons.length}강</dd>
          </div>
          <div>
            <dt>총 재생 시간</dt>
            <dd>{formatCourseDuration(totalDurationSeconds)}</dd>
          </div>
          <div>
            <dt>수강 기간</dt>
            <dd>{product.accessLabel}</dd>
          </div>
          <div>
            <dt>학습 지원</dt>
            <dd>{product.feedbackLabel}</dd>
          </div>
        </dl>

        <div className={styles.curriculumPreview}>
          <span>CURRICULUM</span>
          <ol>
            {course.sections.map((section, sectionIndex) => (
              <li key={section.id}>
                <span>{String(sectionIndex + 1).padStart(2, "0")}</span>
                <strong>{section.title}</strong>
                <small>{section.lessons.length}강</small>
              </li>
            ))}
          </ol>
        </div>

        <div className={styles.purchaseArea}>
          <div className={styles.price}>
            <span>수강료 · 부가세 포함</span>
            <strong className="serif">{formatPrice(product.price)}<small>원</small></strong>
          </div>
          <div className={styles.courseActions}>
            <Link href={product.detailHref} className={styles.secondaryAction}>
              강의 자세히 보기
            </Link>
            <Link href={product.checkoutHref} className={styles.primaryAction}>
              수강 신청 <ArrowIcon />
            </Link>
          </div>
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
      <h3>{title}</h3>
      <p>{description}</p>
    </article>
  );
}

function formatCourseDuration(seconds: number) {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}시간 ${minutes}분`;
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
