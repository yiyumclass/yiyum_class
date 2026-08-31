import Image from "next/image";
import Link from "next/link";
import SiteFooter from "@/components/layout/SiteFooter";
import SiteHeader from "@/components/layout/SiteHeader";
import { resolveSalePrice } from "@/lib/store/pricing";
import type { SaleDetail } from "@/lib/store/public-sale";
import ConsultingDetail from "./ConsultingDetail";
import CourseEnrollmentPicker, {
  CourseEnrollmentProvider,
  type MembershipProductOption,
} from "./CourseEnrollmentPicker";
import ResourceDetail from "./ResourceDetail";
import ResourceViewer from "./ResourceViewer";
import styles from "./SaleDetailPage.module.css";

type SaleDetailPageProps = {
  item: SaleDetail;
  membershipProducts?: MembershipProductOption[];
  complianceNotice?: string;
};

export default function SaleDetailPage({
  item,
  membershipProducts,
  complianceNotice,
}: SaleDetailPageProps) {
  const course = item.course;
  const sale = resolveSalePrice(item.priceKrw, item.listPriceKrw);
  const isCourse = item.productType === "course";
  const hasMembershipOptions = membershipProducts !== undefined;

  const content = (
    <div className={styles.page}>
      <SiteHeader
        active={item.headerActive}
        currentPath={item.detailHref}
        useEnrollmentPicker={hasMembershipOptions}
      />

      <main>
        <div className={styles.breadcrumb}>
          <Link href={item.breadcrumbHref}>{item.breadcrumbLabel}</Link>
          <span aria-hidden="true">/</span>
          <span>{item.title}</span>
        </div>

        <section className={styles.hero} aria-labelledby="course-title">
          <div className={styles.visual}>
            {item.thumbnailSrc ? (
              <>
                <Image
                  src={item.thumbnailSrc}
                  alt={`${item.visualCaption}의 ${item.title}`}
                  fill
                  priority
                  sizes="(max-width: 760px) 100vw, 43vw"
                  className={styles.courseImage}
                />
                <div className={styles.imageShade} aria-hidden="true" />
              </>
            ) : (
              <div className={styles.visualPlaceholder} aria-hidden="true">
                <strong className="serif">{item.title.slice(0, 1)}</strong>
              </div>
            )}
            <span className={styles.imageLabel}>{item.visualLabel}</span>
            <span className={styles.instructor}>{item.visualCaption}</span>
          </div>

          <div className={styles.heroContent}>
            <span className={styles.eyebrow}>{item.eyebrow}</span>
            <h1 id="course-title" className="serif">{item.title}</h1>
            <p className={styles.summary}>{item.summary}</p>

            <dl className={styles.facts}>
              {item.facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>

            <div className={styles.purchaseArea}>
              {isCourse ? (
                <div className={styles.enrollmentPrompt}>
                  <span>수강 안내</span>
                  <strong>신청할 때 필요한 도움의 범위를 선택할 수 있어요.</strong>
                </div>
              ) : (
                <div className={styles.price}>
                  <span>
                    {item.priceKrw === 0
                      ? "신청만 하면 바로 받아요"
                      : `${priceLabel(item)} · 부가세 포함`}
                  </span>
                  {sale.listPriceKrw !== null && (
                    <div className={styles.saleRow}>
                      <span className={styles.discount}>
                        {sale.discountPercent}% 할인
                      </span>
                      <s className={styles.listPrice}>
                        {formatPrice(sale.listPriceKrw)}원
                      </s>
                    </div>
                  )}
                  <strong className="serif">
                    {item.priceKrw === 0 ? (
                      "무료"
                    ) : (
                      <>
                        {formatPrice(item.priceKrw)}
                        <small>원</small>
                      </>
                    )}
                  </strong>
                </div>
              )}
              <div className={styles.actions}>
                {hasMembershipOptions ? (
                  <CourseEnrollmentPicker
                    triggerClassName={styles.primaryAction}
                  />
                ) : item.soldOut ? (
                  <span className={styles.soldOutAction} aria-disabled="true">
                    품절
                  </span>
                ) : item.ctaHref ? (
                  <Link href={item.ctaHref} className={styles.primaryAction}>
                    {item.ctaLabel} <ArrowIcon />
                  </Link>
                ) : (
                  // 보낼 데가 없으면 버튼을 그리지 않는다. 눌러도 아무 일이
                  // 없으면 고장으로 읽힌다.
                  <span className={styles.soldOutAction} aria-disabled="true">
                    준비 중
                  </span>
                )}
              </div>
            </div>
            {item.soldOut && !hasMembershipOptions && (
              <p className={styles.soldOutNotice} role="status">
                지금은 신청을 받지 않습니다. 다음 모집이 열리면 안내드릴게요.
              </p>
            )}
          </div>
        </section>

        {course ? (
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
            {!course.outlineReady && <p>상세 커리큘럼 준비 중</p>}
          </div>

          {course.course.sections.length > 0 ? (
            <div className={styles.sectionList}>
              {course.course.sections.map((section, sectionIndex) => (
                <details key={section.id} open={sectionIndex === 0}>
                  <summary>
                    <span className={`serif ${styles.sectionNumber}`}>
                      {String(sectionIndex + 1).padStart(2, "0")}
                    </span>
                    <span className={styles.sectionTitle}>
                      <strong>{section.title}</strong>
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
        ) : item.productType === "consulting" ? (
          <ConsultingDetail slug={item.slug} />
        ) : (
          <>
            <ResourceViewer
              view={item.pageView}
              unlockHref={item.unlockHref}
              unlockLabel={item.unlockLabel}
              free={item.priceKrw === 0}
            />
            <ResourceDetail
              paragraphs={item.detailParagraphs}
              items={item.detailItems}
              // 무료 자료는 화면에서 읽는 것이라, 볼 페이지가 있으면 준비가 끝난
              // 것이다. 파일 유무로 판단하면 페이지가 다 있는데도 준비 중이라고
              // 말하게 된다.
              hasFile={
                item.priceKrw === 0
                  ? item.pageView.totalCount > 0
                  : item.hasFile
              }
            />
          </>
        )}

        <section className={styles.bottomCta}>
          <div>
            <span>READY TO START?</span>
            <h2 className="serif">{closingHeadline(item)}</h2>
          </div>
          <div>
            {!isCourse && (
              <strong className="serif">
                {item.priceKrw === 0 ? "무료" : `${formatPrice(item.priceKrw)}원`}
              </strong>
            )}
            {hasMembershipOptions ? (
              <CourseEnrollmentPicker
                triggerClassName={styles.bottomEnrollmentAction}
              />
            ) : item.soldOut ? (
              <span className={styles.soldOutAction} aria-disabled="true">품절</span>
            ) : item.ctaHref ? (
              <Link href={item.ctaHref}>{item.ctaLabel} <ArrowIcon /></Link>
            ) : (
              <span className={styles.soldOutAction} aria-disabled="true">준비 중</span>
            )}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );

  return hasMembershipOptions ? (
    <CourseEnrollmentProvider
      products={membershipProducts}
      complianceNotice={complianceNotice}
    >
      {content}
    </CourseEnrollmentProvider>
  ) : (
    content
  );
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

function priceLabel(item: SaleDetail) {
  if (item.productType === "consulting") return "이용료";
  if (item.productType === "ebook") return item.priceKrw === 0 ? "비용" : "자료 가격";
  return "수강료";
}

function closingHeadline(item: SaleDetail) {
  if (item.soldOut) return "이번 모집은 마감되었어요.";
  if (item.productType === "consulting") return "계정을 함께 열어볼 준비가 되셨다면.";
  if (item.productType === "ebook") {
    return item.priceKrw === 0
      ? "지금 바로 읽어보세요."
      : "지금 받아서 오늘 바로 써보세요.";
  }
  return "내 속도에 맞춰 시작해 보세요.";
}
