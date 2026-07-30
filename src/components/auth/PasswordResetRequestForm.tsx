"use client";

import Link from "next/link";
import { useState } from "react";
import { isLikelyEmail } from "@/lib/auth/password";
import { createClient } from "@/lib/supabase/client";

export default function PasswordResetRequestForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;

    if (!isLikelyEmail(email)) {
      setError("이메일 주소를 확인해 주세요.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: `${window.location.origin}/auth/callback?next=/account/password` }
      );

      // 가입되지 않은 주소인지 알려주면 계정 존재 여부가 새어 나간다.
      // 성공과 실패를 같은 화면으로 처리한다.
      if (resetError) {
        console.error("Failed to request a password reset:", resetError.code ?? resetError.name);
      }
      setSent(true);
    } catch (caught) {
      console.error("Unexpected password reset failure:", caught);
      setError("메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div role="status" style={{ display: "grid", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#57514A" }}>
          입력하신 주소로 가입된 계정이 있다면 비밀번호 재설정 메일을 보냈습니다.
          메일의 링크를 열면 새 비밀번호를 정할 수 있어요.
        </p>
        <p style={{ margin: 0, fontSize: 13, color: "#938B7F", lineHeight: 1.6 }}>
          메일이 보이지 않으면 스팸함을 확인해 주세요. 카카오로 가입한 계정에는
          이윰 클래스 비밀번호가 없어 메일이 오지 않습니다.
        </p>
        <Link href="/login" style={{ color: "#B85C38", fontWeight: 600, fontSize: 14 }}>
          로그인으로 돌아가기
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
      <input
        className="auth-input"
        type="email"
        placeholder="가입한 이메일"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        aria-label="가입한 이메일"
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
        {loading ? "보내는 중…" : "재설정 메일 받기"}
      </button>

      {error && (
        <p role="alert" style={{ color: "#C0392B", fontSize: 13, margin: 0 }}>
          {error}
        </p>
      )}
    </form>
  );
}
