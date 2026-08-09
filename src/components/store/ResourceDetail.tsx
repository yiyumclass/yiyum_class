import type { PublicDetailItem } from "@/lib/store/public-detail-items";
import ScrollReveal from "./ScrollReveal";
import styles from "./ResourceDetail.module.css";

type ResourceDetailProps = {
  paragraphs: string[];
  items: PublicDetailItem[];
  hasFile: boolean;
};

/**
 * 자료 상세. 히어로 아래에 이어 붙는다.
 *
 * 컨설팅과 달리 길게 설득할 자리가 아니다. 무료 자료는 이미 받기로 마음먹고
 * 들어오는 경우가 많아서, 무엇이 들어있는지만 빨리 확인시키면 된다.
 */
export default function ResourceDetail({
  paragraphs,
  items,
  hasFile,
}: ResourceDetailProps) {
  // 소개도 항목도 없으면 빈 섹션만 남는다. 그럴 바엔 히어로에서 바로 끝낸다.
  if (paragraphs.length === 0 && items.length === 0 && hasFile) return null;

  return (
    <div className={styles.detail}>
      <ScrollReveal />

      {paragraphs.length > 0 && (
        <section className={styles.intro} aria-labelledby="resource-intro">
          <span className={styles.eyebrow}>ABOUT</span>
          <h2 id="resource-intro" className="serif">
            어떤 자료인가요
          </h2>
          <div className={styles.lead} data-reveal>
            {paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </section>
      )}

      {items.length > 0 && (
        <section className={styles.contents} aria-labelledby="resource-contents">
          <div className={styles.contentsHeading}>
            <span>WHAT&apos;S INSIDE</span>
            <h2 id="resource-contents" className="serif">
              이런 게 들어있어요
            </h2>
          </div>
          <ol className={styles.itemList}>
            {items.map((item, index) => (
              <li key={item.id} data-reveal data-reveal-delay={String(index * 60)}>
                <span className={`serif ${styles.itemNumber}`}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong>{item.title}</strong>
                  {item.body && <p>{item.body}</p>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {!hasFile && (
        <section className={styles.pending}>
          <p role="status">
            자료 파일을 준비하고 있습니다. 준비되면 신청하신 분께 먼저 알려드릴게요.
          </p>
        </section>
      )}
    </div>
  );
}
