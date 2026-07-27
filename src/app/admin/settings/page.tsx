import type { Metadata } from "next";
import { upsertAdminUserAction } from "./actions";
import AdminDeactivateAdminButton from "@/components/admin/AdminDeactivateAdminButton";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { loadManagedAdminUsers } from "@/lib/admin/admin-users";
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

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const currentAdmin = await requireOwnerAdmin();
  const [admins, query] = await Promise.all([
    loadManagedAdminUsers(),
    searchParams,
  ]);

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>운영자 권한</h1>
        <p>회원 UUID를 기준으로 owner와 operator 권한을 안전하게 관리합니다.</p>
      </header>

      {query.status && <p className={styles.notice}>운영자 권한 변경을 저장했습니다.</p>}
      {query.error && (
        <p className={styles.error}>{describeSettingsError(query.error)}</p>
      )}

      <section className={styles.panel}>
        <h2>운영자 추가 또는 역할 변경</h2>
        <form action={upsertAdminUserAction} className={styles.form}>
          <input name="userId" required placeholder="회원 UUID" aria-label="회원 UUID" />
          <select name="role" defaultValue="operator" aria-label="관리자 역할">
            <option value="operator">operator</option>
            <option value="owner">owner</option>
          </select>
          <input name="displayName" maxLength={60} placeholder="표시 이름" aria-label="표시 이름" />
          <button type="submit">저장</button>
        </form>
      </section>

      <section className={styles.panel}>
        <h2>현재 운영자</h2>
        <div className={styles.list}>
          {admins.map((admin) => (
            <article className={styles.row} key={admin.userId}>
              <span className={styles.identity}>
                <strong>{admin.displayName || admin.email}</strong>
                <span>{admin.email} · {admin.userId}</span>
              </span>
              <strong>{admin.role}</strong>
              <span className={admin.isActive ? styles.active : styles.inactive}>
                {admin.isActive ? "활성" : "비활성"}
              </span>
              <AdminDeactivateAdminButton
                userId={admin.userId}
                label={admin.displayName || admin.email}
                disabled={!admin.isActive || admin.userId === currentAdmin.userId}
                className={styles.deactivate}
                confirmClassName={styles.deactivateConfirm}
              />
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
