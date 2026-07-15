import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
  ),
  title: "이윰 SNS 수익화 클래스 — 차이는 팔로워 수가 아닙니다",
  description:
    "팔로워 500부터 협찬, 1,000대부터 수익화. 리빙 크리에이터 이윰의 SNS 수익화 VOD 클래스.",
  openGraph: {
    title: "이윰 SNS 수익화 클래스",
    description: "차이는 팔로워 수가 아닙니다 — 처음부터 수익으로 연결되는 계정 설계.",
    type: "website",
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
