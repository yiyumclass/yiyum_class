import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
  ),
  title: "이윰 SNS 수익화 클래스 — 차이는 팔로워 수가 아닙니다",
  description:
    "300명대 첫 협찬 경험부터 1,000명대 브랜드 협업 확장까지, 리빙 크리에이터 이윰의 개인 운영 사례와 계정 설계 기준을 다루는 VOD 클래스.",
  openGraph: {
    title: "이윰 SNS 수익화 클래스",
    description: "차이는 팔로워 수가 아닙니다 — 콘텐츠와 브랜드 협업 준비를 연결하는 계정 설계.",
    type: "website",
    images: ["/assets/profile.jpg"],
  },
  twitter: {
    card: "summary_large_image",
    title: "이윰 SNS 수익화 클래스",
    description: "차이는 팔로워 수가 아닙니다 — 콘텐츠와 브랜드 협업 준비를 연결하는 계정 설계.",
    images: ["/assets/profile.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
