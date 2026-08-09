import Link from "next/link";
import type { ProductPageView } from "@/lib/store/product-pages";
import styles from "./ResourceViewer.module.css";

type ResourceViewerProps = {
  view: ProductPageView;
  /** 잠금을 풀러 가는 곳. 무료면 무료 신청, 유료면 결제다. */
  unlockHref: string;
  unlockLabel: string;
  free: boolean;
};

/**
 * 자료 본문 뷰어.
 *
 * 잠긴 장은 여기서 가리는 것이 아니라 서버가 주소를 만들지 않는다. 가리개는
 * "더 있다"는 사실을 알리는 장치일 뿐이라, 걷어내도 나올 것이 없다.
 */
export default function ResourceViewer({
  view,
  unlockHref,
  unlockLabel,
  free,
}: ResourceViewerProps) {
  if (view.totalCount === 0) return null;

  const visible = view.pages.filter((page) => page.imageUrl !== null);
  const lastVisible = visible.at(-1);

  return (
    <section
      id="resource-viewer"
      className={styles.viewer}
      aria-labelledby="resource-viewer-title"
    >
      <div className={styles.heading}>
        <span>PREVIEW</span>
        <h2 id="resource-viewer-title" className="serif">
          자료 미리보기
        </h2>
        <p>
          전체 {view.totalCount}장 중 {view.unlockedCount}장을 보고 계세요.
        </p>
      </div>

      <div className={styles.pages}>
        {visible.map((page) => (
          <figure
            key={page.pageNumber}
            className={
              view.lockedCount > 0 && page.pageNumber === lastVisible?.pageNumber
                ? `${styles.page} ${styles.pageFading}`
                : styles.page
            }
          >
            {/*
              next/image 를 쓰지 않는다. 서명 주소는 매 요청 달라져서 최적화
              캐시가 쌓이기만 하고 재사용되지 않는다.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={page.imageUrl ?? ""}
              alt={`${page.pageNumber}쪽`}
              width={page.width ?? undefined}
              height={page.height ?? undefined}
              loading={page.pageNumber <= 1 ? "eager" : "lazy"}
              decoding="async"
            />
            <figcaption>{String(page.pageNumber).padStart(2, "0")}</figcaption>
          </figure>
        ))}
      </div>

      {view.lockedCount > 0 && (
        <div className={styles.gate}>
          <strong className="serif">
            나머지 {view.lockedCount}장은 회원에게만 열려 있어요
          </strong>
          <p>
            {free
              ? "로그인만 하시면 나머지도 여기서 바로 이어서 보실 수 있어요. 결제도 내려받기도 없어요."
              : "구매하시면 전체 내용을 바로 보실 수 있고, 원본 파일도 함께 받아가실 수 있어요."}
          </p>
          <Link href={unlockHref} className={styles.gateAction}>
            {unlockLabel} <ArrowIcon />
          </Link>
        </div>
      )}
    </section>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.arrow}>
      <path d="M3.5 10h12M11 5l5 5-5 5" />
    </svg>
  );
}
