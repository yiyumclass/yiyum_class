import Link from "next/link";
import { loadRecentAdminAuditEntries } from "@/lib/admin/audit";
import { requireAdmin } from "@/lib/admin/auth";
import { loadAdminCourses } from "@/lib/admin/courses";
import { loadAdminIntegrationHealth } from "@/lib/admin/health";
import { loadAdminProducts } from "@/lib/admin/products";
import styles from "./admin.module.css";

const implementationSteps = [
  {
    number: "01",
    title: "관리자 권한과 접근 제어",
    description: "일반 회원과 관리자 화면을 분리하고 서버에서 권한을 확인합니다.",
    status: "완료",
    state: "complete",
  },
  {
    number: "02",
    title: "상품 관리",
    description: "강의와 전자책의 가격, 이용 기간과 판매 상태를 관리합니다.",
    status: "완료",
    state: "complete",
  },
  {
    number: "03",
    title: "강의 콘텐츠 관리",
    description: "상품과 강의를 연결하고 챕터, 차시와 영상을 관리합니다.",
    status: "완료",
    state: "complete",
  },
  {
    number: "04",
    title: "전자책 콘텐츠 관리",
    description: "전자책 파일, 버전과 구매 후 열람 흐름을 관리합니다.",
    status: "샘플 대기",
    state: "waiting",
  },
  {
    number: "05",
    title: "주문 · 결제 조회",
    description: "무료 신청 유입과 이용권 발급 상태를 주문 원장에서 확인합니다.",
    status: "완료",
    state: "complete",
  },
  {
    number: "06",
    title: "회원 · 수강권 관리",
    description: "회원별 보유 콘텐츠와 이용 기간, 지급·회수 이력을 관리합니다.",
    status: "완료",
    state: "complete",
  },
  {
    number: "07",
    title: "학습 현황",
    description: "회원별 강의 진도와 최근 학습, 완료 상태를 운영 지표로 확인합니다.",
    status: "완료",
    state: "complete",
  },
  {
    number: "08",
    title: "운영 설정",
    description: "서비스 정책과 운영자 계정, 공통 안내 정보를 관리합니다.",
    status: "다음",
    state: "current",
  },
] as const;

export default async function AdminDashboardPage() {
  const admin = await requireAdmin();
  const [productResult, courseResult, integrationHealth, auditEntries] = await Promise.all([
    loadAdminProducts(),
    loadAdminCourses(),
    loadAdminIntegrationHealth(),
    loadRecentAdminAuditEntries(),
  ]);
  const lessonCount = courseResult.courses.reduce(
    (courseTotal, course) =>
      courseTotal +
      course.sections.reduce(
        (sectionTotal, section) => sectionTotal + section.lessons.length,
        0
      ),
    0
  );
  const connectedVideoCount = courseResult.courses.reduce(
    (courseTotal, course) =>
      courseTotal +
      course.sections.reduce(
        (sectionTotal, section) =>
          sectionTotal + section.lessons.filter((lesson) => lesson.videoPath).length,
        0
      ),
    0
  );
  const courseCount = productResult.products.filter(
    (product) => product.productType === "course" && product.status === "active"
  ).length;
  const ebookCount = productResult.products.filter(
    (product) => product.productType === "ebook" && product.status === "active"
  ).length;

  const platformReady =
    productResult.databaseReady &&
    courseResult.databaseReady &&
    courseResult.videoStorageReady &&
    integrationHealth.allReady;

  const contentSummary = [
    { label: "판매 중 강의", value: courseCount, unit: "개" },
    { label: "전체 차시", value: lessonCount, unit: "강" },
    { label: "연결된 영상", value: connectedVideoCount, unit: "개" },
    { label: "판매 중 전자책", value: ebookCount, unit: "권" },
  ];

  return (
    <div className={styles.dashboard}>
      <section className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>OVERVIEW</p>
          <h1>운영 현황</h1>
          <p className={styles.headingDescription}>
            {admin.displayName}님, 현재 콘텐츠와 어드민 구축 상태를 확인하세요.
          </p>
        </div>
        <Link href="/" className={styles.outlineLink}>
          사용자 화면 보기
          <span aria-hidden="true">↗</span>
        </Link>
      </section>

      <section className={styles.summarySection} aria-labelledby="content-summary-title">
        <div className={styles.sectionHeadingRow}>
          <div>
            <h2 id="content-summary-title">현재 콘텐츠</h2>
            <p>현재 코드에 연결된 상품과 학습 콘텐츠 기준입니다.</p>
          </div>
          <span className={platformReady ? styles.syncStatus : styles.syncStatusWarning}>
            <span aria-hidden="true" />
            {platformReady ? "전체 연동 정상" : "일부 연동 점검 필요"}
          </span>
        </div>

        <div className={styles.integrationStatus} aria-label="사용자 화면 연동 상태">
          <IntegrationState label="상품·강의 DB" ready={productResult.databaseReady && courseResult.databaseReady} />
          <IntegrationState label="공개 커리큘럼" ready={integrationHealth.publicOutlineReady} />
          <IntegrationState label="무료 신청·수강권" ready={integrationHealth.entitlementReady} />
          <IntegrationState label="영상 저장·재생" ready={courseResult.videoStorageReady && integrationHealth.videoDeliveryReady} />
        </div>

        <div className={styles.summaryGrid}>
          {contentSummary.map((item) => (
            <article className={styles.summaryCard} key={item.label}>
              <p>{item.label}</p>
              <strong>
                {item.value}
                <span>{item.unit}</span>
              </strong>
            </article>
          ))}
        </div>
      </section>

      <div className={styles.dashboardGrid}>
        <section className={styles.panel} aria-labelledby="build-progress-title">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.panelKicker}>SETUP ROADMAP</p>
              <h2 id="build-progress-title">어드민 구축 단계</h2>
            </div>
            <span className={styles.progressFraction}>6 / 8</span>
          </div>

          <ol className={styles.stepList}>
            {implementationSteps.map((step) => (
              <li className={styles.stepItem} key={step.number}>
                <span className={`${styles.stepNumber} ${styles[step.state]}`}>
                  {step.state === "complete" ? <CheckIcon /> : step.number}
                </span>
                <span className={styles.stepCopy}>
                  <strong>{step.title}</strong>
                  <span>{step.description}</span>
                </span>
                <span className={`${styles.stepStatus} ${styles[step.state]}`}>
                  {step.status}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.panel} aria-labelledby="next-work-title">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.panelKicker}>NEXT</p>
              <h2 id="next-work-title">다음 작업</h2>
            </div>
          </div>

          <div className={styles.nextWork}>
            <span className={styles.nextWorkIndex}>08</span>
            <h3>운영 정책과 관리자 계정 설정을 한곳에 정리합니다</h3>
            <p>
              콘텐츠·주문·회원·학습 운영 화면이 준비됐습니다. 다음 단계에서는 서비스
              공통 정책과 운영자 권한, 화면 안내 정보를 안전하게 관리합니다.
            </p>
            <ul>
              <li>운영자 계정과 역할 상태 관리</li>
              <li>고객 안내·문의와 서비스 공통 정보</li>
              <li>변경 권한 제한과 감사 로그 기록</li>
            </ul>
            <span className={styles.nextWorkPending}>
              운영 설정 탭에서 이어서 구현합니다
              <span aria-hidden="true">→</span>
            </span>
          </div>
        </section>
      </div>

      {admin.role === "owner" && (
        <section className={styles.auditPanel} aria-labelledby="recent-audit-title">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.panelKicker}>AUDIT LOG</p>
              <h2 id="recent-audit-title">최근 운영 변경</h2>
            </div>
            <span className={styles.ownerOnlyBadge}>최고 관리자만 표시</span>
          </div>
          {auditEntries.length > 0 ? (
            <ol className={styles.auditList}>
              {auditEntries.map((entry) => (
                <li key={entry.id}>
                  <span className={styles.auditIcon} aria-hidden="true">{formatAuditTarget(entry.targetType)}</span>
                  <span className={styles.auditCopy}>
                    <strong>{formatAuditAction(entry.action)}</strong>
                    <small>{entry.targetLabel} · {entry.actorName}</small>
                  </span>
                  <time dateTime={entry.createdAt}>{formatAdminDateTime(entry.createdAt)}</time>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.auditEmpty}>아직 표시할 운영 변경 기록이 없습니다.</p>
          )}
        </section>
      )}

      <section className={styles.securityNotice}>
        <ShieldIcon />
        <div>
          <strong>관리자 권한은 서버와 데이터베이스에서 확인합니다.</strong>
          <p>
            이메일이나 화면 표시만으로 관리자 여부를 판단하지 않으며, 이후 모든 저장
            작업도 같은 권한 검사를 거치게 됩니다.
          </p>
        </div>
      </section>
    </div>
  );
}

function IntegrationState({ label, ready }: { label: string; ready: boolean }) {
  return (
    <span className={ready ? styles.integrationReady : styles.integrationWarning}>
      <span aria-hidden="true">{ready ? "✓" : "!"}</span>
      {label}
    </span>
  );
}

function formatAuditAction(action: string) {
  const labels: Record<string, string> = {
    "product.created": "상품을 등록했습니다",
    "product.updated": "상품 정보를 변경했습니다",
    "courses.created": "강의를 연결했습니다",
    "courses.updated": "강의 정보를 변경했습니다",
    "course_sections.created": "챕터를 추가했습니다",
    "course_sections.updated": "챕터를 변경했습니다",
    "lessons.created": "차시를 추가했습니다",
    "lessons.updated": "차시를 변경했습니다",
    "entitlement.granted": "수강권을 지급했습니다",
    "entitlement.updated": "수강권을 변경했습니다",
    "entitlement.revoked": "수강권을 회수했습니다",
  };
  return labels[action] ?? "운영 정보를 변경했습니다";
}

function formatAuditTarget(targetType: string) {
  return {
    product: "상품",
    products: "상품",
    courses: "강의",
    course_sections: "챕터",
    lessons: "차시",
    product_entitlements: "수강권",
  }[targetType] ?? "변경";
}

function formatAdminDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5 10 3 3 7-7" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 4.5 6v5.6c0 4.6 3.1 7.7 7.5 9.4 4.4-1.7 7.5-4.8 7.5-9.4V6L12 3Z" />
      <path d="m8.5 12 2.2 2.2 4.8-5" />
    </svg>
  );
}
