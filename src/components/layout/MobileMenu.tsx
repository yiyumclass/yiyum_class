"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import styles from "./MobileMenu.module.css";

type NavItem = { key: string; label: string; href: string };

type MobileMenuProps = {
  navItems: NavItem[];
  activeKey?: string;
  isAdmin: boolean;
  enrollHref: string;
};

// 모바일 전용 햄버거 메뉴. 데스크탑에서는 CSS로 숨겨지고, 서버 헤더가 넘겨준
// 내비 항목을 받아 토글 동작만 담당한다. 로그인/마이클래스는 헤더에 인라인으로
// 남기므로 드로어에는 담지 않는다.
//
// 오버레이는 createPortal로 document.body에 렌더한다. 헤더가 backdrop-filter를 써서
// position:fixed의 containing block이 되어버리면(=드로어가 헤더 높이에 갇힘) 레이아웃이
// 깨지므로, 헤더 DOM 밖으로 빼내야 한다.
export default function MobileMenu({
  navItems,
  activeKey,
  isAdmin,
  enrollHref,
}: MobileMenuProps) {
  const [open, setOpen] = useState(false);

  // 열려 있을 때 배경 스크롤 잠금 + Escape 닫기.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  const overlay = (
    <div className={styles.backdrop} onClick={close} role="presentation">
      <nav
        className={styles.drawer}
        aria-label="모바일 메뉴"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.drawerHeader}>
          <button
            type="button"
            className={styles.close}
            aria-label="메뉴 닫기"
            onClick={close}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
              <path
                d="M5 5l12 12M17 5L5 17"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <ul className={styles.list}>
          {navItems.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className={`${styles.link} ${activeKey === item.key ? styles.active : ""}`}
                aria-current={activeKey === item.key ? "page" : undefined}
                onClick={close}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className={styles.footerActions}>
          {isAdmin ? (
            <Link href="/admin" className={styles.cta} onClick={close}>
              관리자
            </Link>
          ) : (
            <Link href={enrollHref} className={styles.cta} onClick={close}>
              수강 신청
            </Link>
          )}
        </div>
      </nav>
    </div>
  );

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        aria-label="메뉴 열기"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className={styles.bar} />
        <span className={styles.bar} />
        <span className={styles.bar} />
      </button>

      {open && createPortal(overlay, document.body)}
    </>
  );
}
