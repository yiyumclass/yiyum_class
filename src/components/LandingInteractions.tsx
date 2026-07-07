"use client";

import { useEffect } from "react";

/**
 * 랜딩 페이지의 순수 DOM 인터랙션.
 * - 스크롤 등장(reveal) 애니메이션
 * - 스크롤 시 네비게이션 색 전환
 * - 하단 스티키 구매 바 노출/숨김
 * 렌더링 결과가 없는 effect-only 컴포넌트.
 */
export default function LandingInteractions() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let io: IntersectionObserver | undefined;

    // 스크롤 등장
    if (!reduce && "IntersectionObserver" in window) {
      const items = Array.from(
        document.querySelectorAll<HTMLElement>("[data-reveal]")
      );
      items.forEach((el) => {
        el.style.opacity = "0";
        el.style.transform = "translateY(22px)";
        el.style.transition =
          "opacity 0.8s cubic-bezier(0.16,1,0.3,1), transform 0.8s cubic-bezier(0.16,1,0.3,1)";
        const d = el.getAttribute("data-reveal-delay");
        if (d) el.style.transitionDelay = d + "ms";
      });
      io = new IntersectionObserver(
        (ents) => {
          ents.forEach((e) => {
            if (e.isIntersecting) {
              const t = e.target as HTMLElement;
              t.style.opacity = "1";
              t.style.transform = "none";
              io?.unobserve(t);
            }
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
      );
      items.forEach((el) => io!.observe(el));
    }

    // nav 색 전환 + 스티키 구매 바
    const nav = document.getElementById("nav");
    const hero = document.getElementById("hero");
    const bar = document.getElementById("buyBar");
    const applyEl = document.getElementById("apply");

    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop;
      const past = hero ? y > hero.offsetHeight - 72 : y > 400;
      if (nav) {
        if (past) {
          nav.style.background = "rgba(243,239,232,0.85)";
          nav.style.backdropFilter = "blur(12px)";
          nav.style.setProperty("-webkit-backdrop-filter", "blur(12px)");
          nav.style.borderBottomColor = "#DDD5C8";
        } else {
          nav.style.background = "transparent";
          nav.style.backdropFilter = "none";
          nav.style.setProperty("-webkit-backdrop-filter", "none");
          nav.style.borderBottomColor = "transparent";
        }
      }
      if (bar) {
        const applyTop = applyEl
          ? applyEl.getBoundingClientRect().top
          : 99999;
        const show = past && applyTop > window.innerHeight * 0.6;
        bar.style.transform = show ? "translateY(0)" : "translateY(130%)";
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      io?.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return null;
}
