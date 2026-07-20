"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import {
  grantMemberEntitlementAction,
  updateMemberEntitlementAction,
} from "@/app/admin/members/actions";
import type {
  AdminEntitlementStatus,
  AdminMember,
  AdminMemberEntitlement,
  AdminMemberProductOption,
} from "@/lib/admin/members";
import styles from "./AdminMemberManager.module.css";

type AdminMemberManagerProps = {
  members: AdminMember[];
  products: AdminMemberProductOption[];
  databaseReady: boolean;
  sourceMessage: string | null;
  referenceTime: string;
};

type MemberFilter = "all" | "entitled" | "unentitled" | "expiring";
type ExpiryMode = "product" | "unlimited" | "custom";

const memberFilters: Array<{ value: MemberFilter; label: string }> = [
  { value: "all", label: "전체 회원" },
  { value: "entitled", label: "수강권 보유" },
  { value: "unentitled", label: "미보유" },
  { value: "expiring", label: "30일 내 만료" },
];

export default function AdminMemberManager({
  members,
  products,
  databaseReady,
  sourceMessage,
  referenceTime,
}: AdminMemberManagerProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MemberFilter>("all");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const selectedMember = members.find((member) => member.id === selectedMemberId) ?? null;
  const referenceDate = useMemo(() => new Date(referenceTime), [referenceTime]);

  const filteredMembers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");

    return members.filter((member) => {
      const activeEntitlements = member.entitlements.filter((entitlement) =>
        isEffectivelyActive(entitlement, referenceDate)
      );
      const matchesQuery =
        !normalizedQuery ||
        member.name.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
        member.email.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
        member.id.toLowerCase().includes(normalizedQuery);
      const matchesFilter =
        filter === "all" ||
        (filter === "entitled" && activeEntitlements.length > 0) ||
        (filter === "unentitled" && activeEntitlements.length === 0) ||
        (filter === "expiring" &&
          activeEntitlements.some((entitlement) =>
            isExpiringSoon(entitlement, referenceDate)
          ));

      return matchesQuery && matchesFilter;
    });
  }, [filter, members, query, referenceDate]);

  const summary = useMemo(() => {
    const activeEntitlements = members
      .flatMap((member) => member.entitlements)
      .filter((entitlement) => isEffectivelyActive(entitlement, referenceDate));
    const thirtyDaysAgo = new Date(referenceDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    return {
      members: members.length,
      active: activeEntitlements.length,
      newMembers: members.filter((member) => new Date(member.joinedAt) >= thirtyDaysAgo).length,
      expiring: activeEntitlements.filter((entitlement) =>
        isExpiringSoon(entitlement, referenceDate)
      ).length,
    };
  }, [members, referenceDate]);

  const runMutation = async (mutation: () => Promise<{ ok: boolean; message: string }>) => {
    setPending(true);
    setNotice(null);
    try {
      const result = await mutation();
      setNotice(result.message);
      return result.ok;
    } catch {
      setNotice("요청을 처리하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.");
      return false;
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>MEMBERS &amp; ENTITLEMENTS</p>
          <h1>회원 · 수강권</h1>
          <p>회원별 보유 콘텐츠와 이용 기간을 확인하고 수강권을 안전하게 운영합니다.</p>
        </div>
        <span className={databaseReady ? styles.liveBadge : styles.pendingBadge}>
          <span aria-hidden="true" />
          {databaseReady ? "운영 데이터" : "설정 필요"}
        </span>
      </section>

      {!databaseReady && (
        <div className={styles.setupNotice} role="status">
          <DatabaseIcon />
          <div>
            <strong>회원·수강권 정보를 아직 관리할 수 없습니다.</strong>
            <p>{sourceMessage}</p>
            <code>20260715170000_create_admin_member_entitlements.sql</code>
          </div>
        </div>
      )}

      {notice && (
        <div className={styles.actionNotice} role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="안내 닫기">
            <CloseIcon />
          </button>
        </div>
      )}

      <section className={styles.summaryBar} aria-label="회원과 수강권 요약">
        <SummaryItem label="전체 회원" value={summary.members} unit="명" />
        <SummaryItem label="활성 수강권" value={summary.active} unit="개" tone="active" />
        <SummaryItem label="최근 30일 가입" value={summary.newMembers} unit="명" />
        <SummaryItem label="30일 내 만료" value={summary.expiring} unit="개" tone="warning" />
      </section>

      <section className={styles.memberPanel} aria-labelledby="member-list-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="member-list-title">회원 목록</h2>
            <p>콘텐츠 접근은 로그인 여부가 아닌 유효한 수강권을 기준으로 합니다.</p>
          </div>
          <span className={styles.resultCount}>총 {formatNumber(filteredMembers.length)}명</span>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.memberFilters} aria-label="회원 필터">
            {memberFilters.map((item) => (
              <button
                type="button"
                key={item.value}
                className={filter === item.value ? styles.filterActive : styles.filter}
                onClick={() => setFilter(item.value)}
                aria-pressed={filter === item.value}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className={styles.searchField}>
            <SearchIcon />
            <span className={styles.visuallyHidden}>회원 검색</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="이름, 이메일 또는 회원 ID"
            />
          </label>
        </div>

        {filteredMembers.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.memberTable}>
              <thead>
                <tr>
                  <th>회원</th>
                  <th>가입일</th>
                  <th>보유 콘텐츠</th>
                  <th>활성 수강권</th>
                  <th>최근 로그인</th>
                  <th><span className={styles.visuallyHidden}>회원 작업</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    canManage={databaseReady}
                    referenceDate={referenceDate}
                    onManage={() => setSelectedMemberId(member.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <MemberIcon />
            <strong>{members.length === 0 ? "아직 가입한 회원이 없습니다." : "조건에 맞는 회원이 없습니다."}</strong>
            <p>{members.length === 0 ? "회원 가입이 완료되면 이곳에서 확인할 수 있습니다." : "검색어 또는 필터를 변경해 보세요."}</p>
          </div>
        )}
      </section>

      {selectedMember && (
        <EntitlementDialog
          member={selectedMember}
          products={products}
          pending={pending}
          referenceDate={referenceDate}
          onClose={() => setSelectedMemberId(null)}
          onGrant={(productId, expiresAt) =>
            runMutation(() => grantMemberEntitlementAction(selectedMember.id, productId, expiresAt))
          }
          onUpdate={(entitlementId, status, expiresAt) =>
            runMutation(() => updateMemberEntitlementAction(entitlementId, status, expiresAt))
          }
        />
      )}
    </div>
  );
}

function SummaryItem({ label, value, unit, tone }: { label: string; value: number; unit: string; tone?: "active" | "warning" }) {
  return (
    <div className={styles.summaryItem}>
      <span>{label}</span>
      <strong className={tone ? styles[`summaryValue_${tone}`] : undefined}>
        {formatNumber(value)}<small>{unit}</small>
      </strong>
    </div>
  );
}

function MemberRow({ member, canManage, referenceDate, onManage }: { member: AdminMember; canManage: boolean; referenceDate: Date; onManage: () => void }) {
  const activeEntitlements = member.entitlements.filter((entitlement) =>
    isEffectivelyActive(entitlement, referenceDate)
  );
  return (
    <tr>
      <td>
        <span className={styles.memberIdentity}>
          <span className={styles.memberAvatar} aria-hidden="true">{member.name.slice(0, 1).toUpperCase()}</span>
          <span>
            <strong>{member.name}</strong>
            <small>{member.email}</small>
          </span>
        </span>
      </td>
      <td data-label="가입일" className={styles.dateCell}>{formatDate(member.joinedAt)}</td>
      <td data-label="보유 콘텐츠">
        {activeEntitlements.length > 0 ? (
          <span className={styles.productChips}>
            {activeEntitlements.slice(0, 2).map((entitlement) => (
              <span key={entitlement.id}>{entitlement.productTitle}</span>
            ))}
            {activeEntitlements.length > 2 && <small>+{activeEntitlements.length - 2}</small>}
          </span>
        ) : <span className={styles.emptyValue}>없음</span>}
      </td>
      <td data-label="활성 수강권">
        <strong className={activeEntitlements.length > 0 ? styles.activeCount : styles.zeroCount}>
          {activeEntitlements.length}<small>개</small>
        </strong>
      </td>
      <td data-label="최근 로그인" className={styles.dateCell}>{member.lastSignInAt ? formatDateTime(member.lastSignInAt) : "기록 없음"}</td>
      <td className={styles.actionCell}>
        <button type="button" disabled={!canManage} onClick={onManage}>수강권 관리</button>
      </td>
    </tr>
  );
}

function EntitlementDialog({
  member,
  products,
  pending,
  referenceDate,
  onClose,
  onGrant,
  onUpdate,
}: {
  member: AdminMember;
  products: AdminMemberProductOption[];
  pending: boolean;
  referenceDate: Date;
  onClose: () => void;
  onGrant: (productId: string, expiresAt: string | null) => Promise<boolean>;
  onUpdate: (entitlementId: string, status: AdminEntitlementStatus, expiresAt: string | null) => Promise<boolean>;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>("product");
  const [customExpiry, setCustomExpiry] = useState("");
  const selectedProduct = products.find((product) => product.id === productId);
  const dialogRef = useRef<HTMLElement>(null);

  useDialogBehavior(dialogRef, pending, onClose);

  const submitGrant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProduct) return;
    const expiresAt = resolveGrantExpiration(selectedProduct, expiryMode, customExpiry);
    if (expiryMode === "custom" && !expiresAt) return;
    await onGrant(selectedProduct.id, expiresAt);
  };

  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pending) onClose();
    }}>
      <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="entitlement-dialog-title">
        <header className={styles.dialogHeader}>
          <div>
            <p>MEMBER ACCESS</p>
            <h2 id="entitlement-dialog-title">{member.name}님의 수강권</h2>
            <span>{member.email}</span>
          </div>
          <button autoFocus type="button" className={styles.dialogClose} onClick={onClose} disabled={pending} aria-label="수강권 관리 닫기">
            <CloseIcon />
          </button>
        </header>

        <div className={styles.dialogBody}>
          <section className={styles.entitlementSection} aria-labelledby="current-entitlements-title">
            <div className={styles.dialogSectionHeading}>
              <h3 id="current-entitlements-title">보유 수강권</h3>
              <span>{member.entitlements.length}개</span>
            </div>
            {member.entitlements.length > 0 ? (
              <div className={styles.entitlementList}>
                {member.entitlements.map((entitlement) => (
                  <EntitlementEditor
                    key={`${entitlement.id}:${entitlement.status}:${entitlement.expiresAt ?? "none"}`}
                    entitlement={entitlement}
                    pending={pending}
                    referenceDate={referenceDate}
                    onUpdate={onUpdate}
                  />
                ))}
              </div>
            ) : (
              <div className={styles.dialogEmpty}>아직 지급된 수강권이 없습니다.</div>
            )}
          </section>

          <form className={styles.grantForm} onSubmit={submitGrant}>
            <div className={styles.dialogSectionHeading}>
              <h3>새 수강권 지급</h3>
              <span>관리자 지급</span>
            </div>
            <label>
              <span>상품</span>
              <select value={productId} onChange={(event) => setProductId(event.target.value)} required>
                {products.map((product) => (
                  <option value={product.id} key={product.id}>
                    {product.title} · {formatProductStatus(product.status)}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>이용 기간</legend>
              <label>
                <input type="radio" name="expiryMode" value="product" checked={expiryMode === "product"} onChange={() => setExpiryMode("product")} />
                상품 기본값 ({selectedProduct?.accessPeriodDays ? `${selectedProduct.accessPeriodDays}일` : "무제한"})
              </label>
              <label>
                <input type="radio" name="expiryMode" value="unlimited" checked={expiryMode === "unlimited"} onChange={() => setExpiryMode("unlimited")} />
                기간 제한 없음
              </label>
              <label>
                <input type="radio" name="expiryMode" value="custom" checked={expiryMode === "custom"} onChange={() => setExpiryMode("custom")} />
                만료일 직접 선택
              </label>
            </fieldset>
            {expiryMode === "custom" && (
              <label>
                <span>만료일</span>
                <input type="date" value={customExpiry} min={getTomorrowDate(referenceDate)} onChange={(event) => setCustomExpiry(event.target.value)} required />
              </label>
            )}
            <button type="submit" className={styles.grantButton} disabled={pending || !selectedProduct}>
              {pending ? "처리 중" : "수강권 지급"}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

function useDialogBehavior(
  dialogRef: RefObject<HTMLElement | null>,
  pending: boolean,
  onClose: () => void
) {
  useEffect(() => {
    const returnFocusTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => returnFocusTo?.focus();
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]'
        )
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);
      if (!firstElement || !lastElement) return;

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dialogRef, onClose, pending]);
}

function EntitlementEditor({
  entitlement,
  pending,
  referenceDate,
  onUpdate,
}: {
  entitlement: AdminMemberEntitlement;
  pending: boolean;
  referenceDate: Date;
  onUpdate: (entitlementId: string, status: AdminEntitlementStatus, expiresAt: string | null) => Promise<boolean>;
}) {
  const effectiveStatus = getEffectiveStatus(entitlement, referenceDate);
  // 이미 만료된 수강권은 과거 만료일을 그대로 되보내면 서버·DB가 거부하므로, 편집 초기값을 무제한("")으로 둔다.
  const [expiration, setExpiration] = useState(
    effectiveStatus === "expired" ? "" : toDateInputValue(entitlement.expiresAt)
  );
  const [expirationError, setExpirationError] = useState<string | null>(null);
  const updateStatus = async (status: AdminEntitlementStatus) => {
    if (status === "revoked" && !window.confirm(`${entitlement.productTitle} 수강권을 회수할까요? 즉시 콘텐츠 접근이 중단됩니다.`)) return;
    if (expiration && new Date(toEndOfDayIso(expiration)) <= referenceDate) {
      setExpirationError("만료일이 지났습니다. 새 만료일을 지정하거나 비워서 무제한으로 저장해 주세요.");
      return;
    }
    setExpirationError(null);
    await onUpdate(entitlement.id, status, expiration ? toEndOfDayIso(expiration) : null);
  };

  return (
    <article className={styles.entitlementCard}>
      <div className={styles.entitlementTop}>
        <span className={styles.productIcon} aria-hidden="true">{entitlement.productType === "course" ? <PlayIcon /> : <BookIcon />}</span>
        <div>
          <strong>{entitlement.productTitle}</strong>
          <span>{formatSource(entitlement.source)} · {formatDate(entitlement.grantedAt)} 지급</span>
        </div>
        <span className={`${styles.entitlementBadge} ${styles[effectiveStatus]}`}>{formatEffectiveStatus(effectiveStatus)}</span>
      </div>
      <div className={styles.entitlementControls}>
        <label>
          <span>만료일</span>
          <input type="date" value={expiration} min={getTomorrowDate(referenceDate)} disabled={pending} onChange={(event) => { setExpiration(event.target.value); setExpirationError(null); }} />
          {expiration && <button type="button" disabled={pending} onClick={() => { setExpiration(""); setExpirationError(null); }}>무제한으로</button>}
          {expirationError && <span className={styles.summaryValue_warning}>{expirationError}</span>}
        </label>
        <span className={styles.entitlementActions}>
          {entitlement.status === "revoked" ? (
            <button type="button" disabled={pending} onClick={() => updateStatus("active")}>다시 활성화</button>
          ) : (
            <>
              <button type="button" disabled={pending} onClick={() => updateStatus("active")}>기간 저장</button>
              <button type="button" className={styles.revokeButton} disabled={pending} onClick={() => updateStatus("revoked")}>회수</button>
            </>
          )}
        </span>
      </div>
    </article>
  );
}

type EffectiveStatus = "active" | "expiring" | "expired" | "revoked";

function getEffectiveStatus(entitlement: AdminMemberEntitlement, referenceDate: Date): EffectiveStatus {
  if (entitlement.status === "revoked") return "revoked";
  if (!entitlement.expiresAt) return "active";
  const expiresAt = new Date(entitlement.expiresAt);
  if (expiresAt <= referenceDate) return "expired";
  return isExpiringSoon(entitlement, referenceDate) ? "expiring" : "active";
}

function isEffectivelyActive(entitlement: AdminMemberEntitlement, referenceDate: Date) {
  return entitlement.status === "active" && (!entitlement.expiresAt || new Date(entitlement.expiresAt) > referenceDate);
}

function isExpiringSoon(entitlement: AdminMemberEntitlement, referenceDate: Date) {
  if (!entitlement.expiresAt || !isEffectivelyActive(entitlement, referenceDate)) return false;
  return new Date(entitlement.expiresAt).getTime() <= referenceDate.getTime() + 30 * 24 * 60 * 60 * 1000;
}

function resolveGrantExpiration(product: AdminMemberProductOption, mode: ExpiryMode, customExpiry: string) {
  if (mode === "unlimited") return null;
  if (mode === "custom") return customExpiry ? toEndOfDayIso(customExpiry) : null;
  if (!product.accessPeriodDays) return null;
  return new Date(Date.now() + product.accessPeriodDays * 24 * 60 * 60 * 1000).toISOString();
}

function toDateInputValue(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function toEndOfDayIso(value: string) {
  return new Date(`${value}T23:59:59+09:00`).toISOString();
}

function getTomorrowDate(referenceDate: Date) {
  const tomorrow = new Date(referenceDate.getTime() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(tomorrow);
}

function formatEffectiveStatus(status: EffectiveStatus) {
  return { active: "이용 가능", expiring: "만료 예정", expired: "만료", revoked: "회수됨" }[status];
}

function formatSource(source: AdminMemberEntitlement["source"]) {
  return { free_checkout: "무료 신청", payment: "결제", admin_grant: "관리자 지급" }[source];
}

function formatProductStatus(status: AdminMemberProductOption["status"]) {
  return { active: "판매 중", draft: "작성 중", paused: "판매 중지" }[status];
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function SearchIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="m12.2 12.2 4 4" /></svg>; }
function CloseIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>; }
function MemberIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 11a3 3 0 0 1 4.5 2.6M17 16a4 4 0 0 1 4 3" /></svg>; }
function DatabaseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></svg>; }
function PlayIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4" width="15" height="12" rx="2" /><path d="m8 7 5 3-5 3V7Z" /></svg>; }
function BookIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3.5h7a3 3 0 0 1 3 3V17H7a3 3 0 0 1-3-3V3.5Z" /><path d="M14 6h2a2 2 0 0 1 2 2v9h-4" /></svg>; }
