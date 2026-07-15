"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hasActiveAdminAccess } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/client";
import ConsentBlock from "./ConsentBlock";

type Mode = "login" | "signup";

// 로그인/회원가입 공용 폼. 랜딩 브랜드 톤(크림 배경·세리프·주황 포인트)에 맞춘다.
// 이메일+비밀번호(Supabase Auth)로 지금 바로 동작하고, 카카오 버튼은 심사 통과 후 그대로 쓴다.
// 회원가입 필수 수집: 이름·닉네임·이메일·전화번호(+비밀번호). 선택정보는 가입 후 별도 수집.
export default function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const isSignup = mode === "signup";

  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
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

  const validate = () => {
    if (!email.includes("@") || email.length < 5)
      return "이메일 주소를 확인해 주세요.";
    if (password.length < 6) return "비밀번호는 6자 이상이어야 해요.";
    if (isSignup) {
      if (password !== passwordConfirm) return "비밀번호가 일치하지 않아요.";
      if (name.trim().length < 1) return "이름을 입력해 주세요.";
      if (nickname.trim().length < 1) return "닉네임을 입력해 주세요.";
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 11)
        return "전화번호를 정확히 입력해 주세요. (숫자 10~11자리)";
      if (!consent.valid) return "필수 항목에 동의해 주세요.";
    }
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

    if (isSignup) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name: name.trim(),
            nickname: nickname.trim(),
            phone: phone.replace(/\D/g, ""),
            marketing_opt_in: consent.marketing,
          },
        },
      });
      if (error) {
        setError(translate(error.message));
        setLoading(false);
        return;
      }
      // 이메일 인증이 꺼져 있으면 session이 바로 발급된다 → 로그인 완료.
      if (data.session) {
        router.push(getNext());
        router.refresh();
        return;
      }
      // 인증이 켜져 있는 경우(대비): 확인 메일 안내.
      setInfo("확인 메일을 보냈어요. 메일의 링크를 눌러 가입을 완료해 주세요.");
      setLoading(false);
      return;
    }

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
          {isSignup ? "이메일로 계정을 만들어 시작하세요" : "다시 오신 것을 환영해요"}
        </p>

        <form onSubmit={submitEmail} style={{ display: "grid", gap: 12 }}>
          {isSignup && (
            <>
              <input
                className="auth-input"
                type="text"
                placeholder="이름"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
              <input
                className="auth-input"
                type="text"
                placeholder="닉네임"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                autoComplete="nickname"
              />
            </>
          )}
          <input
            className="auth-input"
            type="email"
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          {isSignup && (
            <input
              className="auth-input"
              type="tel"
              placeholder="전화번호 ( - 없이 숫자만)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
            />
          )}
          <input
            className="auth-input"
            type="password"
            placeholder={isSignup ? "비밀번호 (6자 이상)" : "비밀번호"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignup ? "new-password" : "current-password"}
          />
          {isSignup && (
            <input
              className="auth-input"
              type="password"
              placeholder="비밀번호 확인"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              autoComplete="new-password"
            />
          )}

          {isSignup && <ConsentBlock onChange={setConsent} />}

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
            {loading ? "처리 중…" : isSignup ? "가입하기" : "로그인"}
          </button>
        </form>

        {error && (
          <p style={{ color: "#C0392B", fontSize: 13, margin: "16px 0 0" }}>{error}</p>
        )}
        {info && (
          <p style={{ color: "#5E6B4F", fontSize: 13, margin: "16px 0 0" }}>{info}</p>
        )}

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

        <button
          onClick={signInWithKakao}
          disabled={loading}
          style={{
            width: "100%",
            height: 48,
            borderRadius: 10,
            border: "none",
            background: "#FEE500",
            color: "#191600",
            fontSize: 15,
            fontWeight: 600,
            cursor: loading ? "default" : "pointer",
            opacity: loading ? 0.6 : 1,
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
