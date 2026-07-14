"use client";

import { useEffect, useState } from "react";

// 회원가입 동의 블록. 필수(만14세·이용약관·개인정보) 미동의 시 가입 불가.
// 상태 변경 시 상위로 { valid, marketing }를 올려보낸다.
type State = { age14: boolean; terms: boolean; marketing: boolean };

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  fontSize: 13,
  color: "#57514A",
  textAlign: "left",
  lineHeight: 1.5,
  cursor: "pointer",
  userSelect: "none",
};

const boxStyle = (checked: boolean): React.CSSProperties => ({
  flexShrink: 0,
  width: 18,
  height: 18,
  marginTop: 1,
  borderRadius: 5,
  border: `1.5px solid ${checked ? "#B85C38" : "#C9C0B2"}`,
  background: checked ? "#B85C38" : "transparent",
  color: "#fff",
  fontSize: 11,
  lineHeight: "15px",
  textAlign: "center",
});

const linkStyle: React.CSSProperties = { color: "#B85C38", textDecoration: "underline" };

function Row({
  checked,
  onToggle,
  bold,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  bold?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        ...rowStyle,
        ...(bold ? { fontWeight: 600, color: "#201C17" } : {}),
      }}
    >
      <span style={boxStyle(checked)}>{checked ? "✓" : ""}</span>
      <span>{children}</span>
    </div>
  );
}

export default function ConsentBlock({
  onChange,
}: {
  onChange: (s: { valid: boolean; marketing: boolean }) => void;
}) {
  const [s, setS] = useState<State>({ age14: false, terms: false, marketing: false });

  useEffect(() => {
    onChange({ valid: s.age14 && s.terms, marketing: s.marketing });
  }, [s, onChange]);

  const allChecked = s.age14 && s.terms && s.marketing;
  const toggleAll = () =>
    setS({ age14: !allChecked, terms: !allChecked, marketing: !allChecked });
  const toggle = (k: keyof State) => setS((prev) => ({ ...prev, [k]: !prev[k] }));
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      style={{
        border: "1px solid #DDD5C8",
        borderRadius: 10,
        padding: "14px 16px",
        display: "grid",
        gap: 12,
        background: "#FBF8F2",
      }}
    >
      <Row checked={allChecked} onToggle={toggleAll} bold>
        전체 동의
      </Row>

      <div style={{ height: 1, background: "#EAE3D6" }} />

      <Row checked={s.age14} onToggle={() => toggle("age14")}>
        <b style={{ color: "#B85C38" }}>[필수]</b> 만 14세 이상입니다
      </Row>

      <Row checked={s.terms} onToggle={() => toggle("terms")}>
        <b style={{ color: "#B85C38" }}>[필수]</b>{" "}
        <a href="/terms" target="_blank" rel="noreferrer" style={linkStyle} onClick={stop}>
          이용약관
        </a>{" "}
        및{" "}
        <a href="/privacy" target="_blank" rel="noreferrer" style={linkStyle} onClick={stop}>
          개인정보 수집·이용
        </a>
        에 동의합니다
      </Row>

      <Row checked={s.marketing} onToggle={() => toggle("marketing")}>
        <b style={{ color: "#938B7F" }}>[선택]</b> 마케팅 정보 수신 동의 (이메일·알림)
      </Row>
    </div>
  );
}
