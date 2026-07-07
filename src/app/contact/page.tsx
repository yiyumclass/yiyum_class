import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "이윰 · 문의하기",
  description: "이윰 SNS 수익화 클래스 문의 — 인스타그램 DM, 카카오톡 채널, 이메일로 편하게 문의하세요.",
};

type Channel = {
  emoji: string;
  name: string;
  sub: string;
  href: string;
  external?: boolean;
};

const CHANNELS: Channel[] = [
  { emoji: "📷", name: "인스타그램 DM", sub: "@yiyum_home", href: "https://www.instagram.com/yiyum_home/", external: true },
  { emoji: "💬", name: "카카오톡 채널", sub: "@yiyum", href: "http://pf.kakao.com/_xoXYPX", external: true },
  { emoji: "✉️", name: "이메일", sub: "yiyum.home@gmail.com", href: "mailto:yiyum.home@gmail.com" },
];

export default function ContactPage() {
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
            style={{
              fontSize: "13px",
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              color: "#B85C38",
              fontWeight: 600,
              marginBottom: "16px",
            }}
          >
            Contact
          </div>
          <div
            className="serif"
            style={{ fontSize: "38px", lineHeight: "1.15", marginBottom: "14px" }}
          >
            문의하기
          </div>
          <div style={{ fontSize: "15px", color: "#57514A", lineHeight: "1.7" }}>
            궁금한 점은 아래 채널로 편하게 남겨주세요.
            <br />
            <span style={{ color: "#938B7F", fontSize: "13px" }}>
              업무시간 평일 10:00–17:00 (점심 12–13시)
            </span>
          </div>
        </div>

        {/* 문의 채널 카드 */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {CHANNELS.map((c) => (
            <a
              key={c.name}
              href={c.href}
              {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="sns-card"
            >
              <span className="sns-emoji" aria-hidden="true">
                {c.emoji}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: "15px", fontWeight: 600, color: "#201C17" }}>
                  {c.name}
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
                  {c.sub}
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
          <a href="/" style={{ fontSize: "13px", color: "#A79F92", letterSpacing: "0.02em" }}>
            ← 이윰 SNS 수익화 클래스로 돌아가기
          </a>
        </div>
      </div>
    </main>
  );
}
