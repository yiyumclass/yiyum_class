import type { Metadata } from "next";
import {
  deactivateAdminUserAction,
  upsertAdminUserAction,
} from "./actions";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { loadManagedAdminUsers } from "@/lib/admin/admin-users";
import styles from "./settings.module.css";

export const metadata: Metadata = {
  title: "운영자 권한 | 이윰 관리자",
  robots: { index: false, follow: false },
};

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
        <p className={styles.error}>
          권한을 변경하지 못했습니다. 입력값과 마지막 owner 여부를 확인해 주세요.
        </p>
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
              <form action={deactivateAdminUserAction}>
                <input type="hidden" name="userId" value={admin.userId} />
                <button
                  type="submit"
                  className={styles.deactivate}
                  disabled={!admin.isActive || admin.userId === currentAdmin.userId}
                >
                  비활성화
                </button>
              </form>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
