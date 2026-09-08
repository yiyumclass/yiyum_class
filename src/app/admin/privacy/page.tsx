import type { Metadata } from "next";
import Link from "next/link";
import { loadPrivacyOperations, PRIVACY_PAGE_SIZE } from "@/lib/admin/privacy";
import { readPage } from "@/lib/admin/list-params";
import styles from "./privacy.module.css";

export const metadata: Metadata = {
  title: "접속 · 탈퇴 기록 | 이윰 관리자",
  robots: { index: false, follow: false },
};

export default async function PrivacyPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const logPage = Math.min(10000, readPage(query.logPage));
  const withdrawalPage = Math.min(10000, readPage(query.withdrawalPage));
  const result = await loadPrivacyOperations(logPage, withdrawalPage);
  const pager = (kind: "logPage" | "withdrawalPage", page: number, total: number) => {
    const href = (target: number) => ({ pathname: "/admin/privacy", query: {
      logPage, withdrawalPage, [kind]: target,
    } });
    return <nav className={styles.pager} aria-label={kind === "logPage" ? "접속기록 페이지" : "탈퇴기록 페이지"}>
      {page > 1 && <Link href={href(page - 1)}>이전</Link>}
      <span>{page}페이지 · 총 {total}건</span>
      {page * PRIVACY_PAGE_SIZE < total && <Link href={href(page + 1)}>다음</Link>}
    </nav>;
  };
  return <div className={styles.page}>
    <header><h1>접속 · 탈퇴 기록</h1><p>최고관리자만 확인할 수 있는 로그인 접속기록과 탈퇴 처리 현황입니다.</p></header>
    <section className={styles.section}>
      <h2>로그인 접속기록</h2>
      <p>성공·실패·차단 내역을 3개월 동안 보관합니다. 만료 기록은 일일 정리 작업으로 삭제합니다.</p>
      {!result.logsReady ? <p role="alert">접속기록을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.</p> : <>
        <div className={styles.tableWrap}><table>
          <thead><tr><th>일시</th><th>로그인 방식</th><th>결과</th><th>접속 IP</th><th>사유</th><th>보관 만료</th></tr></thead>
          <tbody>{result.logs.map(log => <tr key={log.id}>
            <td>{formatDate(log.occurred_at)}</td><td>{log.provider === "kakao" ? "카카오" : "이메일"}</td>
            <td>{{ success: "성공", failure: "실패", blocked: "차단" }[log.outcome]}</td>
            <td>{log.ip_address ?? "—"}</td><td>{formatFailure(log.failure_code)}</td><td>{formatDate(log.retain_until)}</td>
          </tr>)}</tbody>
        </table></div>
        {!result.logs.length && <p>표시할 접속기록이 없습니다.</p>}
        {pager("logPage", logPage, result.logCount)}
      </>}
    </section>
    <section className={styles.section}>
      <h2>탈퇴 처리 현황</h2>
      <p>탈퇴 처리 중인 계정은 서비스 이용이 제한됩니다. 완료된 거래의 주문·환불 원장은 주문 관리에서 확인합니다.</p>
      {!result.withdrawalsReady ? <p role="alert">탈퇴 기록을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.</p> : <>
        <div className={styles.tableWrap}><table>
          <thead><tr><th>요청 일시</th><th>내부 계정 ID</th><th>상태</th><th>카카오 연결 해제</th><th>회원자료 파기</th><th>완료 일시</th></tr></thead>
          <tbody>{result.withdrawals.map(row => <tr key={row.user_id}>
            <td>{formatDate(row.created_at)}</td><td><code>{row.user_id}</code></td>
            <td>{row.status === "completed" ? "완료" : "처리 중"}</td>
            <td>{row.provider === "kakao" ? formatDate(row.provider_unlinked_at) : "해당 없음"}</td>
            <td>{formatDate(row.data_purged_at)}</td><td>{formatDate(row.completed_at)}</td>
          </tr>)}</tbody>
        </table></div>
        {!result.withdrawals.length && <p>표시할 탈퇴 기록이 없습니다.</p>}
        {pager("withdrawalPage", withdrawalPage, result.withdrawalCount)}
      </>}
    </section>
  </div>;
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short",
  }).format(new Date(value)) : "—";
}

function formatFailure(code: string | null) {
  const labels: Record<string, string> = {
    invalid_credentials: "인증 정보 불일치", rate_limited: "로그인 시도 제한",
    email_not_confirmed: "이메일 미인증", signup_consent_required: "가입 미완료",
    consent_lookup_failed: "동의 정보 조회 실패", consent_record_failed: "동의 저장 실패",
    account_inactive: "탈퇴 처리 계정", oauth_exchange_failed: "카카오 인증 연결 실패",
    session_user_missing: "인증 계정 확인 실패",
  };
  return code ? labels[code] ?? "기타 인증 오류" : "—";
}
