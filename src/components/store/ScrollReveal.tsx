"use client";

import { useEffect } from "react";

/**
 * [data-reveal] 을 단 요소를 화면에 들어올 때 올라오며 나타나게 한다.
 *
 * 랜딩 페이지가 쓰는 등장 방식과 같은 곡선과 거리를 쓴다. 판매 페이지끼리
 * 움직임이 다르면 같은 사이트로 읽히지 않는다. 렌더링 결과가 없는
 * effect-only 컴포넌트다.
 */
export default function ScrollReveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;

    const items = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]")
    );
    if (items.length === 0) return;

    items.forEach((el) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(22px)";
      el.style.transition =
        "opacity 0.8s cubic-bezier(0.16,1,0.3,1), transform 0.8s cubic-bezier(0.16,1,0.3,1)";
      const delay = el.dataset.revealDelay;
      if (delay) el.style.transitionDelay = `${delay}ms`;
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const target = entry.target as HTMLElement;
          target.style.opacity = "1";
          target.style.transform = "none";
          observer.unobserve(target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );

    items.forEach((el) => observer.observe(el));

    // 판매 문구가 영영 안 보이는 것보다는 애니메이션을 건너뛰는 편이 낫다.
    // 관찰이 어떤 이유로든 돌지 않으면 시간이 지난 뒤 그냥 드러낸다.
    const failsafe = window.setTimeout(() => {
      items.forEach((el) => {
        if (el.style.opacity === "1") return;
        el.style.opacity = "1";
        el.style.transform = "none";
      });
    }, 4000);

    return () => {
      window.clearTimeout(failsafe);
      observer.disconnect();
    };
  }, []);

  return null;
}
