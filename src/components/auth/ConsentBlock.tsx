"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ConsentBlock.module.css";

// 회원가입 동의 블록. 필수(만14세·이용약관·개인정보) 미동의 시 가입 불가.
// 상태 변경 시 상위로 { valid, marketing }를 올려보낸다.
//
// 법정 동의 UI이므로 네이티브 checkbox를 쓴다. div+onClick으로 흉내 내면
// 키보드로 조작할 수 없고 스크린리더가 체크 상태를 읽어주지 못한다.
type State = { age14: boolean; terms: boolean; marketing: boolean };

function Row({
  checked,
  onToggle,
  strong,
  indeterminate = false,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  strong?: boolean;
  indeterminate?: boolean;
  children: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className={`${styles.row} ${strong ? styles.rowStrong : ""}`}>
      <input
        ref={inputRef}
        type="checkbox"
        className={styles.input}
        checked={checked}
        onChange={onToggle}
      />
      <span className={styles.box} aria-hidden="true">
        {checked ? "✓" : indeterminate ? "–" : ""}
      </span>
      <span>{children}</span>
    </label>
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
  const someChecked = s.age14 || s.terms || s.marketing;
  const toggleAll = () =>
    setS({ age14: !allChecked, terms: !allChecked, marketing: !allChecked });
  const toggle = (k: keyof State) => setS((prev) => ({ ...prev, [k]: !prev[k] }));

  return (
    <div className={styles.block}>
      <Row
        checked={allChecked}
        indeterminate={!allChecked && someChecked}
        onToggle={toggleAll}
        strong
      >
        전체 동의
        {/* 선택 항목까지 함께 켜진다는 것을 밝힌다. 마케팅 동의가 조용히
            켜지면 사용자가 인지하지 못한 채 수신 동의한 것이 된다. */}
        <span className={styles.allNote}>선택 항목 포함</span>
      </Row>

      <div className={styles.divider} />

      <Row checked={s.age14} onToggle={() => toggle("age14")}>
        <b className={styles.required}>[필수]</b> 만 14세 이상입니다
      </Row>

      <Row checked={s.terms} onToggle={() => toggle("terms")}>
        <b className={styles.required}>[필수]</b>{" "}
        <a href="/terms" target="_blank" rel="noreferrer" className={styles.link}>
          이용약관
        </a>{" "}
        및{" "}
        <a href="/privacy" target="_blank" rel="noreferrer" className={styles.link}>
          개인정보 수집·이용
        </a>
        에 동의합니다
      </Row>

      <Row checked={s.marketing} onToggle={() => toggle("marketing")}>
        <b className={styles.optional}>[선택]</b> 마케팅 정보 수신 동의 (이메일·알림)
      </Row>
    </div>
  );
}
