import type { Metadata } from "next";
import { upsertAdminUserAction } from "./actions";
import AdminDeactivateAdminButton from "@/components/admin/AdminDeactivateAdminButton";
import AdminMemberPicker from "@/components/admin/AdminMemberPicker";
import AdminSettingsFeedback, {
  type SettingsFeedback,
} from "@/components/admin/AdminSettingsFeedback";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { loadManagedAdminUsers } from "@/lib/admin/admin-users";
import { loadAdminMemberOptions } from "@/lib/admin/members";
import styles from "./settings.module.css";

export const metadata: Metadata = {
  title: "운영자 권한 | 이윰 관리자",
  robots: { index: false, follow: false },
};

// 액션이 Postgres 에러 코드를 그대로 전달한다. 원인별로 다르게 안내해야
// 운영자가 "마지막 owner라 거부됨"과 "대상이 없음"을 구분할 수 있다.
function describeSettingsError(code: string) {
  if (code === "invalid") {
    return "회원 UUID 형식이 올바르지 않습니다. 36자리 UUID를 입력해 주세요.";
  }
  if (code === "23514") {
    return "마지막 활성 owner는 비활성화할 수 없습니다. 다른 owner를 먼저 지정해 주세요.";
  }
  if (code === "P0002") {
    return "해당 회원을 찾지 못했습니다. 회원 UUID를 다시 확인해 주세요.";
  }
  if (code === "42501") {
    return "권한이 부족합니다. owner 계정으로 다시 시도해 주세요.";
  }
  return "권한을 변경하지 못했습니다. 입력값과 마지막 owner 여부를 확인해 주세요.";
}

const LAST_OWNER_REASON =
  "마지막 활성 owner입니다. 다른 회원을 owner로 지정한 뒤에 변경할 수 있습니다.";

function formatJoinedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const currentAdmin = await requireOwnerAdmin();
  const [admins, memberResult, query] = await Promise.all([
    loadManagedAdminUsers(),
    loadAdminMemberOptions(),
    searchParams,
  ]);

  const feedback: SettingsFeedback | null = query.error
    ? { tone: "error", message: describeSettingsError(query.error) }
    : query.status
      ? {
          tone: "success",
          message:
            query.status === "deactivated"
              ? "운영자 권한을 해제했습니다."
              : "운영자 권한 변경을 저장했습니다.",
        }
      : null;

  const memberOptions = memberResult.options;

  const activeOwnerCount = admins.filter(
    (admin) => admin.isActive && admin.role === "owner"
  ).length;

  // 비활성 계정을 섞어 두면 지금 누가 접근 가능한지 한눈에 안 보인다.
  const sortedAdmins = [...admins].sort((left, right) => {
    if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
    if (left.role !== right.role) return left.role === "owner" ? -1 : 1;
    return left.createdAt.localeCompare(right.createdAt);
  });

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>운영자 권한</h1>
        <p>회원을 찾아 owner와 operator 권한을 부여하거나 해제합니다.</p>
      </header>

      <AdminSettingsFeedback
        feedback={feedback}
        className={styles.notice}
        errorClassName={styles.error}
      />

      <section className={styles.panel}>
        <h2>운영자 추가 또는 역할 변경</h2>
        <form action={upsertAdminUserAction} className={styles.form}>
          <AdminMemberPicker
            members={memberOptions}
            unavailableNotice={
              memberResult.databaseReady
                ? null
                : "회원 목록을 불러오지 못해 UUID 직접 입력만 가능합니다."
            }
          />

          <label className={styles.field}>
            <span>역할</span>
            <select name="role" defaultValue="operator">
              <option value="operator">operator</option>
              <option value="owner">owner</option>
            </select>
          </label>

          <label className={styles.field}>
            <span>표시 이름</span>
            <input name="displayName" maxLength={60} placeholder="선택 입력" />
          </label>

          <button type="submit" className={styles.submit}>
            저장
          </button>
        </form>
      </section>

      <section className={styles.panel}>
        <h2>현재 운영자</h2>
        <div className={styles.list}>
          {sortedAdmins.map((admin) => {
            const isSelf = admin.userId === currentAdmin.userId;
            const isLastOwner =
              admin.isActive && admin.role === "owner" && activeOwnerCount <= 1;
            const blockedReason = !admin.isActive
              ? "이미 비활성 상태입니다."
              : isSelf
                ? "자기 자신의 권한은 해제할 수 없습니다."
                : isLastOwner
                  ? LAST_OWNER_REASON
                  : null;

            return (
              <article
                className={admin.isActive ? styles.row : styles.rowInactive}
                key={admin.userId}
              >
                <span className={styles.identity}>
                  <strong>
                    {admin.displayName || admin.email}
                    {isSelf && <span className={styles.selfBadge}>나</span>}
                  </strong>
                  <span>{admin.email}</span>
                  <span className={styles.meta}>
                    {formatJoinedAt(admin.createdAt)} 등록 · {admin.userId}
                  </span>
                </span>

                <span className={admin.isActive ? styles.active : styles.inactive}>
                  {admin.isActive ? "활성" : "비활성"}
                </span>

                {/* 역할 변경은 같은 액션을 재사용한다. 표시 이름을 함께 실어야
                    변경 과정에서 기존 이름이 지워지지 않는다. */}
                <form action={upsertAdminUserAction} className={styles.roleForm}>
                  <input type="hidden" name="userId" value={admin.userId} />
                  <input
                    type="hidden"
                    name="displayName"
                    value={admin.displayName ?? ""}
                  />
                  <label>
                    <span className={styles.visuallyHidden}>
                      {admin.email} 역할
                    </span>
                    <select name="role" defaultValue={admin.role} disabled={isLastOwner}>
                      <option value="operator">operator</option>
                      <option value="owner">owner</option>
                    </select>
                  </label>
                  <button type="submit" disabled={isLastOwner}>
                    역할 저장
                  </button>
                </form>

                <AdminDeactivateAdminButton
                  userId={admin.userId}
                  label={admin.displayName || admin.email}
                  disabled={Boolean(blockedReason)}
                  blockedReason={blockedReason}
                  className={styles.deactivate}
                />

                {isLastOwner && <p className={styles.rowReason}>{LAST_OWNER_REASON}</p>}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
