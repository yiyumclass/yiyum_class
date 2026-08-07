import { consultingCopyBySlug } from "@/lib/store/consulting-copy";
import ScrollReveal from "./ScrollReveal";
import styles from "./ConsultingDetail.module.css";

type ConsultingDetailProps = {
  slug: string;
};

/**
 * 컨설팅 판매 상세. 히어로 아래에 이어 붙는다.
 *
 * 강의는 이 자리에 커리큘럼이 오지만 컨설팅은 팔아야 할 것이 목차가 아니라
 * "내 계정을 봐준다"는 경험이라, 읽는 순서를 막막함 → 해결 → 신뢰 → 신청으로
 * 짠다.
 */
export default function ConsultingDetail({ slug }: ConsultingDetailProps) {
  const copy = consultingCopyBySlug[slug];
  if (!copy) return null;

  return (
    <div className={styles.detail}>
      <ScrollReveal />
      <section className={styles.intro} aria-labelledby="consulting-headline">
        <div className={styles.introGrid}>
          <div data-reveal>
            <span className={styles.eyebrow}>LIVE 1:1 CONSULTING</span>
            <h2 id="consulting-headline" className={`serif ${styles.headline}`}>
              {copy.headlineLines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </h2>
          </div>
          <div className={styles.lead} data-reveal data-reveal-delay="120">
            {copy.lead.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <p className={`serif ${styles.promise}`}>
              {copy.promiseLines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </p>
          </div>
        </div>
      </section>

      <section className={styles.needs} aria-labelledby="consulting-needs">
        <h3 id="consulting-needs" className="serif">
          {copy.needTitle}
        </h3>
        <ul>
          {copy.needs.map((need, index) => (
            <li key={need} data-reveal data-reveal-delay={String(index * 60)}>
              <CheckIcon />
              <span>{need}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.covers} aria-labelledby="consulting-covers">
        <div className={styles.coversHeading}>
          <span>WHAT WE COVER</span>
          <h3 id="consulting-covers" className="serif">
            {copy.coversTitle}
          </h3>
        </div>
        <ol className={styles.coverList}>
          {copy.covers.map((item, index) => (
            <li key={item.title} data-reveal data-reveal-delay={String(index * 60)}>
              <span className={`serif ${styles.coverNumber}`}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.process} aria-labelledby="consulting-process">
        <h3 id="consulting-process" className="serif">
          {copy.processTitle}
        </h3>
        <dl>
          {copy.process.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.fit} aria-labelledby="consulting-fit">
        <h3 id="consulting-fit" className={`serif ${styles.visuallyHidden}`}>
          추천 대상
        </h3>
        <div className={styles.fitColumn} data-reveal>
          <strong>{copy.recommendTitle}</strong>
          <ul>
            {copy.recommends.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className={`${styles.fitColumn} ${styles.fitCaution}`} data-reveal data-reveal-delay="100">
          <strong>{copy.cautionTitle}</strong>
          <ul>
            {copy.cautions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.faq} aria-labelledby="consulting-faq">
        <div className={styles.faqHeading}>
          <span>FAQ</span>
          <h3 id="consulting-faq" className="serif">
            자주 묻는 질문
          </h3>
        </div>
        <div className={styles.faqList}>
          {copy.faqs.map((faq, index) => (
            <details key={faq.title} open={index === 0}>
              <summary>
                <span className={styles.faqLabel}>Q{index + 1}</span>
                <strong>{faq.title}</strong>
                <ChevronIcon />
              </summary>
              <p>{faq.body}</p>
            </details>
          ))}
        </div>
      </section>

    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.checkIcon}>
      <path d="m5 10.4 3 3 7-7.4" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.chevronIcon}>
      <path d="m5.5 8 4.5 4 4.5-4" />
    </svg>
  );
}
