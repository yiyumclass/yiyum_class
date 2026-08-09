import Image from "next/image";
import Link from "next/link";
import SiteFooter from "@/components/layout/SiteFooter";
import SiteHeader from "@/components/layout/SiteHeader";
import { formatKrw, resolveSalePrice } from "@/lib/store/pricing";
import type { SaleCard } from "@/lib/store/public-sale";
import styles from "./ShelfPage.module.css";

export type ShelfPageProps = {
  navKey: "ebook" | "library";
  currentPath: string;
  eyebrow: string;
  title: string;
  lead: string;
  items: SaleCard[];
  countLabel: string;
  emptyTitle: string;
  emptyBody: string;
};

/**
 * 자료 목록 화면.
 *
 * 전자책과 무료 자료가 같은 생김새를 쓰되 주소와 문구만 다르다. 파는 것과
 * 나눠주는 것을 한 화면에 세우면 전자책 값이 싸 보이므로 목록을 나눈다.
 */
export default function ShelfPage({
  navKey,
  currentPath,
  eyebrow,
  title,
  lead,
  items,
  countLabel,
  emptyTitle,
  emptyBody,
}: ShelfPageProps) {
  return (
    <div className={styles.page}>
      <SiteHeader active={navKey} currentPath={currentPath} />

      <main>
        <section className={styles.hero} aria-labelledby="shelf-title">
          <div className={styles.heroInner}>
            <div>
              <span className={styles.eyebrow}>{eyebrow}</span>
              <h1 id="shelf-title" className="serif">
                {title}
              </h1>
            </div>
            <p>{lead}</p>
          </div>
        </section>

        {items.length === 0 ? (
          <section className={styles.catalog}>
            <div className={styles.emptyState}>
              <strong>{emptyTitle}</strong>
              <p>{emptyBody}</p>
            </div>
          </section>
        ) : (
          <section className={styles.catalog} aria-labelledby="shelf-list-title">
            <div className={styles.sectionHeading}>
              <div>
                <span className={`serif ${styles.sectionNumber}`}>01</span>
                <h2 id="shelf-list-title" className="serif">
                  {title}
                </h2>
              </div>
              <span className={styles.count}>
                {String(items.length).padStart(2, "0")} {countLabel}
              </span>
            </div>

            <div className={styles.grid}>
              {items.map((item, index) => (
                <ResourceCard key={item.key} item={item} priority={index < 4} />
              ))}
            </div>
          </section>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

function ResourceCard({ item, priority }: { item: SaleCard; priority: boolean }) {
  const sale = resolveSalePrice(item.priceKrw, item.listPriceKrw);
  const free = item.priceKrw === 0;

  return (
    <article className={styles.card}>
      <Link href={item.detailHref} className={styles.visual} aria-label={`${item.title} 자세히 보기`}>
        {item.thumbnailSrc ? (
          <>
            <Image
              src={item.thumbnailSrc}
              alt={item.title}
              fill
              priority={priority}
              sizes="(max-width: 680px) 100vw, (max-width: 1020px) 50vw, 25vw"
              className={styles.image}
            />
            <div className={styles.imageShade} aria-hidden="true" />
          </>
        ) : (
          <div className={styles.placeholder} aria-hidden="true">
            <span>{item.visualLabel}</span>
            <strong className="serif">{item.title.slice(0, 1)}</strong>
          </div>
        )}
        <span className={styles.badge}>{item.visualLabel}</span>
      </Link>

      <div className={styles.body}>
        <h3 className="serif">
          <Link href={item.detailHref}>{item.title}</Link>
        </h3>
        <p className={styles.summary}>{item.summary}</p>

        <div className={styles.footer}>
          <div className={styles.price}>
            {sale.listPriceKrw !== null && (
              <s className={styles.listPrice}>{formatKrw(sale.listPriceKrw)}원</s>
            )}
            <strong className="serif">
              {free ? "무료" : `${formatKrw(item.priceKrw)}원`}
            </strong>
          </div>
          <Link href={item.detailHref} className={styles.action}>
            {free ? "읽어보기" : "자세히 보기"} <ArrowIcon />
          </Link>
        </div>
      </div>
    </article>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.arrow}>
      <path d="M3.5 10h12M11 5l5 5-5 5" />
    </svg>
  );
}
