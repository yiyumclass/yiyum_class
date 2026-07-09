/**
 * 후기/인증 이미지 갤러리.
 * - 데스크탑: 가로로 자동 스크롤하는 2줄 마퀴(순수 CSS 애니메이션).
 * - 모바일: 전체 이미지를 2단 메이슨리로 세로 나열(카톡 후기 전부 노출).
 * 서버 컴포넌트로 렌더(JS 불필요). CSS 미디어쿼리로 둘 중 하나만 표시한다.
 */
type Props = {
  images: string[];
  alt: string;
};

function Row({ images, alt, dir }: { images: string[]; alt: string; dir: "mq-l" | "mq-r" }) {
  const doubled = [...images, ...images];
  return (
    <div className="mq">
      <div className={`mq-track ${dir}`}>
        {doubled.map((src, i) => (
          <div className="mq-card" key={i} aria-hidden={i >= images.length}>
            <img src={src} alt={i < images.length ? alt : ""} loading="lazy" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ReviewMarquee({ images, alt }: Props) {
  const mid = Math.ceil(images.length / 2);
  const row1 = images.slice(0, mid);
  const row2 = images.slice(mid);
  return (
    <>
      {/* 데스크탑: 자동 스크롤 마퀴 2줄 */}
      <div className="mq-wall mq-desktop" data-reveal="">
        <Row images={row1} alt={alt} dir="mq-l" />
        <Row images={row2} alt={alt} dir="mq-r" />
      </div>
      {/* 모바일: 전체 후기 2단 메이슨리 */}
      <div className="mq-masonry mq-mobile" data-reveal="">
        {images.map((src, i) => (
          <img key={i} src={src} alt={alt} loading="lazy" className="mq-masonry-img" />
        ))}
      </div>
    </>
  );
}
