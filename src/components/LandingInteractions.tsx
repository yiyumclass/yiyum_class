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
      document.documentElement.classList.add("reveal-ready");
      io = new IntersectionObserver(
        (ents) => {
          ents.forEach((e) => {
            if (e.isIntersecting) {
              const t = e.target as HTMLElement;
              t.classList.add("is-revealed");
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
      // nav 배경: 스크롤 시작 직후 켜서 본문이 투명 nav 뒤로 지나가며 겹치는 것 방지
      const navSolid = y > 8;
      // buyBar: 히어로를 거의 다 지난 뒤에만 노출(기존 타이밍 유지)
      const past = hero ? y > hero.offsetHeight - 72 : y > 400;
      if (nav) {
        nav.classList.toggle("nav-solid", navSolid);
      }
      if (bar) {
        const applyTop = applyEl
          ? applyEl.getBoundingClientRect().top
          : 99999;
        const show = past && applyTop > window.innerHeight * 0.6;
        bar.classList.toggle("buy-bar-visible", show);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      io?.disconnect();
      window.removeEventListener("scroll", onScroll);
      document.documentElement.classList.remove("reveal-ready");
    };
  }, []);

  return null;
}
