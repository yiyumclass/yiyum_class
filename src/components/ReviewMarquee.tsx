/**
 * 후기/인증 이미지를 가로로 자동 스크롤하는 2줄 마퀴 월.
 * 순수 CSS 애니메이션(JS 불필요) — 서버 컴포넌트로 렌더.
 * 각 줄은 seamless 무한 루프를 위해 이미지 세트를 2번 렌더한다.
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
    <div className="mq-wall" data-reveal="">
      <Row images={row1} alt={alt} dir="mq-l" />
      <Row images={row2} alt={alt} dir="mq-r" />
    </div>
  );
}
