import Link from "next/link";
import { AlertIcon } from "@/components/admin/icons";
import {
  formatAdminDateTime,
  formatAuditAction,
  formatAuditTarget,
} from "@/lib/admin/audit-labels";
import { loadRecentAdminAuditEntries } from "@/lib/admin/audit";
import { requireAdmin } from "@/lib/admin/auth";
import { loadAdminCourses } from "@/lib/admin/courses";
import { loadAdminIntegrationHealth } from "@/lib/admin/health";
import { loadAdminMemberSummary } from "@/lib/admin/members";
import { loadAdminOrderSummary } from "@/lib/admin/orders";
import { loadAdminProducts } from "@/lib/admin/products";
import { getPaymentMode } from "@/lib/store/free-enrollment";
import styles from "./admin.module.css";

export default async function AdminDashboardPage() {
  const admin = await requireAdmin();
  const isOwner = admin.role === "owner";
  const [
    productResult,
    courseResult,
    integrationHealth,
    auditEntries,
    orderResult,
    memberResult,
  ] = await Promise.all([
    loadAdminProducts(),
    loadAdminCourses(),
    loadAdminIntegrationHealth(),
    loadRecentAdminAuditEntries(),
    loadAdminOrderSummary(),
    loadAdminMemberSummary(),
  ]);

  // 집계는 전부 SQL이 계산한다. 기간 경계(KST 오늘, 최근 30일)도 RPC 안에 있다.
  const orderSummary = orderResult.summary;
  const memberSummary = memberResult.summary;

  const paymentMode = getPaymentMode();
  const revenueNote =
    paymentMode === "toss_test" ? "테스트 승인액입니다" : "결제 완료 기준입니다";
  const money = (value: number) => `${value.toLocaleString("ko-KR")}원`;

  // 지표별로 출처가 다르므로, 실패한 쪽만 "—"로 두고 나머지는 그대로 보여준다.
  const ordersReady = orderResult.databaseReady;
  const membersReady = memberResult.databaseReady;

  // 서버 집계는 기간별 결제액을 나눠주지 않는다. 없는 숫자를 지어내지 않도록
  // 기간 카드를 접고 누적 한 장으로 둔다.
  const revenueCards = [
    {
      label: "누적 결제액",
      value: ordersReady ? money(orderSummary.paidAmount) : "—",
      note: revenueNote,
    },
  ];

  const operationCards = [
    {
      label: "오늘 신청",
      value: ordersReady ? `${orderSummary.todayOrders.toLocaleString("ko-KR")}건` : "—",
      note: "무료·유료 신청 전체입니다",
      href: "/admin/orders",
    },
    {
      label: "최근 30일 신규 가입",
      value: membersReady ? `${memberSummary.newMembers.toLocaleString("ko-KR")}명` : "—",
      note: "가입일 기준입니다",
      href: "/admin/members",
    },
    {
      label: "30일 내 만료 예정 수강권",
      value: membersReady
        ? `${memberSummary.expiringEntitlements.toLocaleString("ko-KR")}건`
        : "—",
      note: "전체 기준입니다",
      href: "/admin/members?filter=expiring",
    },
  ];

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
            {admin.displayName}님, 오늘의 운영 지표와 처리할 일을 확인하세요.
          </p>
        </div>
        <Link href="/" className={styles.outlineLink}>
          사용자 화면 보기
          <span aria-hidden="true">↗</span>
        </Link>
      </section>

      <section className={styles.summarySection} aria-labelledby="operation-kpi-title">
        <div className={styles.sectionHeadingRow}>
          <div>
            <h2 id="operation-kpi-title">오늘의 운영</h2>
            <p>모든 기간은 한국 시간 기준입니다.</p>
          </div>
        </div>

        {!ordersReady && (
          <p className={styles.kpiNotice} role="status">
            주문 정보를 불러오지 못했습니다.
          </p>
        )}
        {!membersReady && (
          <p className={styles.kpiNotice} role="status">
            회원 정보를 불러오지 못했습니다.
          </p>
        )}

        <div className={styles.kpiGrid}>
          {/* operator는 환불 권한이 없어 매출 수치로 할 수 있는 조치가 없다.
              금액 카드는 owner에게만 보여준다. */}
          {isOwner &&
            revenueCards.map((card) => (
              <article className={styles.kpiCard} key={card.label}>
                <p>{card.label}</p>
                <strong>{card.value}</strong>
                <small>{card.note}</small>
              </article>
            ))}

          {operationCards.map((card) => (
            <Link className={styles.kpiCard} key={card.label} href={card.href}>
              <p>{card.label}</p>
              <strong>{card.value}</strong>
              <small>{card.note}</small>
            </Link>
          ))}

          <Link
            className={orderSummary.attentionTotal > 0 ? styles.kpiCardAlert : styles.kpiCard}
            href="/admin/orders?attention=1"
          >
            <p>
              이행 확인 필요
              {orderSummary.attentionTotal > 0 && <AlertIcon className={styles.kpiIcon} />}
            </p>
            <strong>
              {ordersReady ? `${orderSummary.attentionTotal.toLocaleString("ko-KR")}건` : "—"}
            </strong>
            <small>전체 기준입니다</small>
          </Link>
        </div>
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

        {/* 연동 점검은 매일 볼 지표가 아니다. 이상이 있을 때만 펼쳐 둔다. */}
        <details className={styles.integrationDetails} open={!platformReady}>
          <summary>사용자 화면 연동 상태</summary>
          <div className={styles.integrationStatus}>
            <IntegrationState
              label="상품·강의 DB"
              ready={productResult.databaseReady && courseResult.databaseReady}
            />
            <IntegrationState label="공개 커리큘럼" ready={integrationHealth.publicOutlineReady} />
            <IntegrationState
              label="무료 신청·수강권"
              ready={
                integrationHealth.entitlementReady &&
                integrationHealth.libraryReady &&
                integrationHealth.ownedCourseReady
              }
            />
            <IntegrationState
              label={
                integrationHealth.videoDelivery === "no-content"
                  ? "영상 저장·재생 (연결된 영상 없음)"
                  : "영상 저장·재생"
              }
              ready={
                courseResult.videoStorageReady &&
                integrationHealth.videoDelivery === "ready"
              }
            />
          </div>
        </details>

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

      {isOwner && (
        <section className={styles.auditPanel} aria-labelledby="recent-audit-title">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.panelKicker}>AUDIT LOG</p>
              <h2 id="recent-audit-title">최근 운영 변경</h2>
            </div>
            <Link href="/admin/audit" className={styles.outlineLink}>
              전체 기록 보기
              <span aria-hidden="true">↗</span>
            </Link>
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
