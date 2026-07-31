"use client";

import { useMemo, useState } from "react";
import { CloseIcon, SearchIcon } from "@/components/admin/icons";
import styles from "./AdminMemberPicker.module.css";

export type AdminMemberOption = {
  id: string;
  name: string;
  email: string;
};

/** 한 번에 보여줄 후보 수. 회원이 늘어도 목록이 화면을 밀어내지 않게 끊는다. */
const VISIBLE_LIMIT = 8;

/**
 * 운영자로 지정할 회원을 이름·이메일로 찾는다.
 *
 * 이전에는 36자리 회원 UUID를 손으로 적어야 했는데, 그 UUID를 어디서 얻는지
 * 화면 어디에도 없었다. 검색으로 고르되, 목록에 없는 계정(이미 운영자인 회원 등)을
 * 위해 직접 입력 경로는 남긴다.
 */
export default function AdminMemberPicker({
  members,
  unavailableNotice,
}: {
  members: AdminMemberOption[];
  unavailableNotice?: string | null;
}) {
  const [manual, setManual] = useState(members.length === 0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AdminMemberOption | null>(null);

  const matches = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (keyword.length === 0) return [];
    return members
      .filter(
        (member) =>
          member.name.toLowerCase().includes(keyword) ||
          member.email.toLowerCase().includes(keyword)
      )
      .slice(0, VISIBLE_LIMIT);
  }, [members, query]);

  if (manual) {
    return (
      <div className={styles.picker}>
        <label className={styles.label} htmlFor="admin-user-id">
          회원 UUID
        </label>
        <input
          id="admin-user-id"
          name="userId"
          required
          placeholder="00000000-0000-0000-0000-000000000000"
          className={styles.input}
        />
        {unavailableNotice && <p className={styles.hint}>{unavailableNotice}</p>}
        {members.length > 0 && (
          <button
            type="button"
            className={styles.toggle}
            onClick={() => setManual(false)}
          >
            회원 검색으로 고르기
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.picker}>
      <label className={styles.label} htmlFor="admin-member-search">
        회원 검색
      </label>

      {selected ? (
        <div className={styles.selected}>
          <span className={styles.selectedIdentity}>
            <strong>{selected.name}</strong>
            <span>{selected.email}</span>
          </span>
          <button
            type="button"
            className={styles.clear}
            aria-label="선택한 회원 해제"
            onClick={() => setSelected(null)}
          >
            <CloseIcon />
          </button>
          <input type="hidden" name="userId" value={selected.id} />
        </div>
      ) : (
        <>
          <div className={styles.searchField}>
            <SearchIcon />
            <input
              id="admin-member-search"
              type="search"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="이름 또는 이메일로 검색"
              className={styles.input}
            />
          </div>

          {query.trim().length > 0 && (
            <ul className={styles.results}>
              {matches.length > 0 ? (
                matches.map((member) => (
                  <li key={member.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(member);
                        setQuery("");
                      }}
                    >
                      <strong>{member.name}</strong>
                      <span>{member.email}</span>
                    </button>
                  </li>
                ))
              ) : (
                <li className={styles.empty}>일치하는 회원이 없습니다.</li>
              )}
            </ul>
          )}
        </>
      )}

      <button type="button" className={styles.toggle} onClick={() => setManual(true)}>
        회원 UUID 직접 입력
      </button>
    </div>
  );
}
