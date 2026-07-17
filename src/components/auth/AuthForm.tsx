"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hasActiveAdminAccess } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/client";
import ConsentBlock from "./ConsentBlock";

type Mode = "login" | "signup";

// 로그인/회원가입 공용 폼. 랜딩 브랜드 톤(크림 배경·세리프·주황 포인트)에 맞춘다.
// 가입은 카카오 전용: 필수 약관 동의 후 "카카오로 시작하기"만 노출한다(이메일 가입 폼 없음).
// 로그인은 카카오+이메일 병행: 관리자·기존 이메일 계정이 계속 로그인할 수 있도록 이메일 폼을 유지한다.
export default function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const isSignup = mode === "signup";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState({ valid: false, marketing: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // 로그인 후 돌아갈 경로. open redirect 방지를 위해 사이트 내부 경로만 허용.
  const getNext = () => {
    if (typeof window === "undefined") return "/";
    const raw = new URLSearchParams(window.location.search).get("next");
    return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  };

  // 이메일 로그인 폼 검증. 가입은 카카오 전용이라 이메일 검증은 로그인만 대상으로 한다.
  const validate = () => {
    if (!email.includes("@") || email.length < 5)
      return "이메일 주소를 확인해 주세요.";
    if (password.length < 6) return "비밀번호는 6자 이상이어야 해요.";
    return null;
  };

  const translate = (message: string) => {
    const m = message.toLowerCase();
    if (m.includes("invalid login credentials"))
      return "이메일 또는 비밀번호가 올바르지 않습니다.";
    if (m.includes("already registered") || m.includes("already exists"))
      return "이미 가입된 이메일이에요. 로그인해 주세요.";
    if (m.includes("email not confirmed"))
      return "이메일 인증이 필요해요. 받은 메일의 링크를 눌러 주세요.";
    if (m.includes("password")) return "비밀번호는 6자 이상이어야 해요.";
    return message;
  };

  // 이메일+비밀번호 로그인. 가입은 카카오 전용이라 이 경로는 로그인 폼에서만 호출된다.
  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setLoading(true);
    const supabase = createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setError(translate(error.message));
      setLoading(false);
      return;
    }
    const isAdmin = data.user
      ? await hasActiveAdminAccess(supabase, data.user.id)
      : false;
    router.push(isAdmin ? "/admin" : getNext());
    router.refresh();
  };

  const signInWithKakao = async () => {
    setError(null);
    setInfo(null);
    // 가입은 카카오 전용이므로 필수 약관 동의 없이는 진행하지 않는다.
    if (isSignup && !consent.valid) {
      setError("필수 항목에 동의해 주세요.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const next = encodeURIComponent(getNext());
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "kakao",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${next}` },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
    // 성공 시 카카오로 리다이렉트되므로 이후 코드는 실행되지 않음
  };

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "40px 24px",
        background: "#F3EFE8",
        color: "#201C17",
      }}
    >
      <style>{`
        .auth-input {
          width: 100%; height: 48px; padding: 0 14px; box-sizing: border-box;
          border: 1px solid #DDD5C8; border-radius: 10px; background: #FBF8F2;
          font-size: 15px; color: #201C17; outline: none;
          transition: border-color 0.2s ease;
        }
        .auth-input::placeholder { color: #A79F92; }
        .auth-input:focus { border-color: #B85C38; }

        @media (max-width: 430px) {
          /* iOS Safari는 입력창 font-size가 16px 미만이면 포커스 시 자동 확대(줌)한다.
             기능/레이아웃은 그대로 두고 모바일에서만 폰트를 16px로 올려 줌을 막는다. */
          .auth-input { font-size: 16px; }
        }
      `}</style>

      <div style={{ width: "100%", maxWidth: 380, textAlign: "center" }}>
        <Link
          href="/"
          className="serif"
          style={{ display: "inline-block", fontSize: 30, color: "#201C17", marginBottom: 10 }}
        >
          이윰 클래스
        </Link>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 6px" }}>
          {isSignup ? "회원가입" : "로그인"}
        </h1>
        <p style={{ color: "#938B7F", fontSize: 14, margin: "0 0 26px" }}>
          {isSignup ? "카카오로 3초 만에 시작하세요" : "다시 오신 것을 환영해요"}
        </p>

        {/* 가입은 카카오 전용 → 이메일 폼은 로그인 모드에서만 렌더한다. */}
        {!isSignup && (
          <form onSubmit={submitEmail} style={{ display: "grid", gap: 12 }}>
            <input
              className="auth-input"
              type="email"
              placeholder="이메일"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <input
              className="auth-input"
              type="password"
              placeholder="비밀번호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
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
                color: "#F6F1E9",
                fontSize: 15,
                fontWeight: 600,
                cursor: loading ? "default" : "pointer",
                opacity: loading ? 0.6 : 1,
                marginTop: 4,
              }}
            >
              {loading ? "처리 중…" : "로그인"}
            </button>
          </form>
        )}

        {/* 가입 필수 약관 동의. 카카오 버튼 활성화 조건(consent.valid)의 근거. */}
        {isSignup && (
          <div style={{ textAlign: "left", marginBottom: 20 }}>
            <ConsentBlock onChange={setConsent} />
          </div>
        )}

        {error && (
          <p style={{ color: "#C0392B", fontSize: 13, margin: "16px 0 0" }}>{error}</p>
        )}
        {info && (
          <p style={{ color: "#5E6B4F", fontSize: 13, margin: "16px 0 0" }}>{info}</p>
        )}

        {!isSignup && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              margin: "24px 0",
              color: "#B7AE9F",
              fontSize: 12,
            }}
          >
            <span style={{ flex: 1, height: 1, background: "#DDD5C8" }} />
            또는
            <span style={{ flex: 1, height: 1, background: "#DDD5C8" }} />
          </div>
        )}

        <button
          onClick={signInWithKakao}
          disabled={loading || (isSignup && !consent.valid)}
          style={{
            width: "100%",
            height: 48,
            borderRadius: 10,
            border: "none",
            background: "#FEE500",
            color: "#191600",
            fontSize: 15,
            fontWeight: 600,
            cursor: loading || (isSignup && !consent.valid) ? "default" : "pointer",
            opacity: loading || (isSignup && !consent.valid) ? 0.6 : 1,
          }}
        >
          카카오로 {isSignup ? "시작하기" : "로그인"}
        </button>

        <p style={{ fontSize: 13, color: "#938B7F", marginTop: 22 }}>
          {isSignup ? (
            <>
              이미 계정이 있으신가요?{" "}
              <Link href="/login" style={{ color: "#B85C38", fontWeight: 600 }}>
                로그인
              </Link>
            </>
          ) : (
            <>
              계정이 없으신가요?{" "}
              <Link href="/signup" style={{ color: "#B85C38", fontWeight: 600 }}>
                회원가입
              </Link>
            </>
          )}
        </p>

        <p style={{ marginTop: 16 }}>
          <Link href="/" style={{ fontSize: 13, color: "#938B7F" }}>
            ← 홈으로
          </Link>
        </p>
      </div>
    </main>
  );
}
