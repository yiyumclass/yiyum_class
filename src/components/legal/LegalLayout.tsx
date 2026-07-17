import Link from "next/link";
import SiteFooter from "@/components/layout/SiteFooter";
import SiteHeader from "@/components/layout/SiteHeader";

// 법정문서(개인정보처리방침·이용약관) 공용 레이아웃. 읽기 좋은 본문 타이포 + 시행일 + 검토 배너.
export default function LegalLayout({
  title,
  effectiveDate,
  currentPath,
  children,
}: {
  title: string;
  effectiveDate: string;
  currentPath: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader currentPath={currentPath} />
      <main
      style={{
        background: "#F3EFE8",
        color: "#201C17",
        minHeight: "100dvh",
        padding: "56px 24px 100px",
      }}
    >
      <style>{`
        .legal { max-width: 760px; margin: 0 auto; }
        .legal h2 {
          font-size: 18px; font-weight: 700; margin: 40px 0 14px;
          padding-top: 20px; border-top: 1px solid #DDD5C8;
        }
        .legal h2:first-of-type { border-top: none; padding-top: 0; margin-top: 24px; }
        .legal h3 { font-size: 15px; font-weight: 600; margin: 22px 0 8px; color: #2E2820; }
        .legal p { font-size: 14px; line-height: 1.85; color: #45403A; margin: 0 0 12px; }
        .legal ul, .legal ol { margin: 0 0 14px; padding-left: 20px; }
        .legal li { font-size: 14px; line-height: 1.8; color: #45403A; margin: 4px 0; }
        .legal table { width: 100%; border-collapse: collapse; margin: 8px 0 18px; font-size: 13px; }
        .legal th, .legal td {
          border: 1px solid #DDD5C8; padding: 8px 10px; text-align: left;
          vertical-align: top; line-height: 1.6; color: #45403A;
        }
        .legal th { background: #EAE3D6; font-weight: 600; color: #2E2820; white-space: nowrap; }
        .legal strong { color: #201C17; }
        .legal a { color: #B85C38; }

        @media (max-width: 760px) {
          /* 제목 크기·여백 축소, 표는 가로 스크롤로 대응(내용은 그대로 두고 스크롤 컨테이너만 부여) */
          .legal h2 {
            font-size: 16.5px; margin: 32px 0 12px; padding-top: 18px;
          }
          .legal h2:first-of-type { margin-top: 20px; }
          .legal h3 { font-size: 14.5px; margin: 20px 0 8px; }
          .legal table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
          .legal th, .legal td { white-space: normal; }
        }
      `}</style>

      <div className="legal">
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 8px" }}>{title}</h1>
        <p style={{ fontSize: 13, color: "#938B7F", margin: "0 0 20px" }}>
          시행일: {effectiveDate}
        </p>

        <div
          style={{
            background: "#FBF3EC",
            border: "1px solid #E7C7B4",
            borderRadius: 10,
            padding: "12px 16px",
            fontSize: 12.5,
            lineHeight: 1.7,
            color: "#8A5A3C",
            marginBottom: 8,
          }}
        >
          ⚠️ 이 문서는 서비스 오픈을 위한 <strong>초안</strong>입니다. 실제 공개·심사 제출 전
          사업자 정보와 조항을 검토해 주세요. (환불·청약철회 조항은 특히 확인 권장)
        </div>

        {children}

        <div style={{ marginTop: 48, fontSize: 13 }}>
          <Link href="/" style={{ color: "#938B7F" }}>
            ← 홈으로
          </Link>
        </div>
      </div>
      </main>
      <SiteFooter />
    </>
  );
}
