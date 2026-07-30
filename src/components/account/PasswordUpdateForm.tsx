"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MIN_PASSWORD_LENGTH, checkNewPassword } from "@/lib/auth/password";
import { createClient } from "@/lib/supabase/client";

export default function PasswordUpdateForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;

    const check = checkNewPassword(password, confirmation);
    if (!check.ok) {
      setNotice({ ok: false, message: check.message });
      return;
    }

    setLoading(true);
    setNotice(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        console.error("Failed to update password:", error.code ?? error.name);
        setNotice({
          ok: false,
          message:
            error.code === "same_password"
              ? "이전과 다른 비밀번호를 입력해 주세요."
              : "비밀번호를 변경하지 못했습니다. 로그인이 만료됐다면 다시 로그인한 뒤 시도해 주세요.",
        });
        return;
      }

      setPassword("");
      setConfirmation("");
      setNotice({ ok: true, message: "비밀번호를 변경했습니다." });
      router.refresh();
    } catch (caught) {
      console.error("Unexpected password update failure:", caught);
      setNotice({ ok: false, message: "비밀번호를 변경하지 못했습니다." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
      <input
        className="auth-input"
        type="password"
        placeholder={`새 비밀번호 (${MIN_PASSWORD_LENGTH}자 이상)`}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="new-password"
        aria-label="새 비밀번호"
      />
      <input
        className="auth-input"
        type="password"
        placeholder="새 비밀번호 확인"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        autoComplete="new-password"
        aria-label="새 비밀번호 확인"
      />
      <button
        type="submit"
        disabled={loading}
        style={{
          width: "100%",
          height: 48,
          borderRadius: 10,
          border: "none",
          background: "#B85C38",
          color: "#fff",
          fontSize: 15,
          fontWeight: 600,
          cursor: loading ? "default" : "pointer",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? "변경 중…" : "비밀번호 변경"}
      </button>

      {notice && (
        <p
          role={notice.ok ? "status" : "alert"}
          style={{
            margin: 0,
            fontSize: 13,
            color: notice.ok ? "#3E6B4A" : "#C0392B",
          }}
        >
          {notice.message}
        </p>
      )}
    </form>
  );
}
