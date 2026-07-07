import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "이윰 · SNS & 링크 모음",
  description: "리빙 크리에이터 · SNS 수익화 코치 이윰의 채널 모음 — 인스타그램, 유튜브, 틱톡, 오늘의집, 카카오톡 채널.",
};

type Link = {
  emoji: string;
  name: string;
  sub: string;
  href: string;
  external?: boolean;
};

const LINKS: Link[] = [
  { emoji: "📷", name: "Instagram", sub: "@yiyum_home", href: "https://www.instagram.com/yiyum_home/", external: true },
  { emoji: "▶️", name: "YouTube", sub: "@yiyum_home", href: "https://www.youtube.com/@yiyum_home", external: true },
  { emoji: "🎵", name: "TikTok", sub: "@yiyum_home", href: "https://www.tiktok.com/@yiyum_home", external: true },
  { emoji: "🏠", name: "오늘의집", sub: "이윰 프로필", href: "https://ozip.me/yoNzuIy?af", external: true },
  { emoji: "💬", name: "카카오톡 채널", sub: "@yiyum", href: "http://pf.kakao.com/_xoXYPX", external: true },
  { emoji: "✉️", name: "이메일", sub: "yiyum.home@gmail.com", href: "mailto:yiyum.home@gmail.com" },
];

export default function SnsPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#F3EFE8",
        color: "#201C17",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "72px 22px 96px",
      }}
    >
      <div style={{ width: "100%", maxWidth: "440px" }}>
        {/* 헤더 */}
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <div
            className="serif"
            style={{ fontSize: "40px", lineHeight: "1.1", marginBottom: "14px" }}
          >
            이윰
          </div>
          <div style={{ fontSize: "14px", color: "#57514A", lineHeight: "1.7" }}>
            리빙 크리에이터 · SNS 수익화 코치
            <br />
            <span style={{ color: "#938B7F" }}>@yiyum_home</span>
          </div>
        </div>

        {/* 링크 카드 */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {LINKS.map((l) => (
            <a
              key={l.name}
              href={l.href}
              {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="sns-card"
            >
              <span className="sns-emoji" aria-hidden="true">
                {l.emoji}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: "15px", fontWeight: 600, color: "#201C17" }}>
                  {l.name}
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: "13px",
                    color: "#938B7F",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {l.sub}
                </span>
              </span>
              <span className="sns-arrow" aria-hidden="true">
                →
              </span>
            </a>
          ))}
        </div>

        {/* 돌아가기 */}
        <div style={{ textAlign: "center", marginTop: "40px" }}>
          <a
            href="/"
            style={{
              fontSize: "13px",
              color: "#A79F92",
              letterSpacing: "0.02em",
            }}
          >
            ← 이윰 SNS 수익화 클래스로 돌아가기
          </a>
        </div>
      </div>
    </main>
  );
}
