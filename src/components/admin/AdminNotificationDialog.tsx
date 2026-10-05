"use client";

import { useEffect, useId, useRef, useState } from "react";
import AdminDialog, { AdminDialogActions } from "./AdminDialog";
import { useAdminFeedback } from "./AdminFeedback";
import { loadMemberNotificationAction, previewMemberNotificationAction, refreshMemberNotificationHistoryAction, sendMemberNotificationAction } from "@/app/admin/members/notification-actions";
import { notificationStatusLabels, type NotificationPanel, type NotificationPreview } from "@/lib/messaging/admin-notification-types";
import styles from "./AdminNotificationDialog.module.css";

export default function AdminNotificationDialog({ memberId, onClose }: { memberId: string; onClose: () => void }) {
  const { toast } = useAdminFeedback();
  const fieldId = useId();
  const [panel, setPanel] = useState<NotificationPanel | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [entitlementId, setEntitlementId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<NotificationPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const requestInFlight = useRef(false);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const template = panel?.templates.find(item => item.id === templateId);
  const entitlement = panel?.entitlements.find(item => item.id === entitlementId);
  const needsEntitlement = !!template?.paymentProductSlug || !!template?.variables.includes("#{product}");
  const choices = panel?.entitlements.filter(item => !template?.paymentProductSlug
    || item.slug === template.paymentProductSlug && item.source === "admin_grant") ?? [];

  useEffect(() => {
    let active = true;
    loadMemberNotificationAction(memberId).then(result => {
      if (!active) return;
      if (result.ok) setPanel(result.data);
      else setError(result.message);
    }).catch(() => {
      if (active) setError("알림톡 설정을 불러오지 못했습니다. 창을 닫고 다시 열어 주세요.");
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [memberId]);

  useEffect(() => {
    if (!preview) return;
    previewHeading.current?.focus();
    previewHeading.current?.scrollIntoView({ block: "start" });
  }, [preview]);

  const invalidate = () => { setPreview(null); setConfirmed(false); setError(""); };
  const run = async (operation: () => Promise<void>) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true);
    setError("");
    try { await operation(); }
    catch { setError("요청 결과를 확인하지 못했습니다. 재발송하지 말고 발송 이력을 확인해 주세요."); }
    finally { requestInFlight.current = false; setBusy(false); }
  };
  const refreshHistory = async () => {
    const result = await refreshMemberNotificationHistoryAction(memberId);
    if (result.ok) setPanel(current => current ? { ...current, history: result.data } : current);
    else setError(result.message);
  };
  const makePreview = () => run(async () => {
    if (!template || !panel) return;
    invalidate();
    const variables = Object.fromEntries(template.variables.map(name => [name,
      ["#{name}", "#{이름}"].includes(name) ? panel.name : name === "#{product}" ? entitlement?.title ?? "" : values[name] ?? "",
    ]));
    const result = await previewMemberNotificationAction({ memberId, templateId, entitlementId: entitlementId || null, variables });
    if (result.ok) setPreview(result.data);
    else setError(result.message);
  });
  const send = () => run(async () => {
    if (!preview || !confirmed) return;
    const draftId = preview.id;
    setPreview(null);
    setConfirmed(false);
    const result = await sendMemberNotificationAction(draftId);
    if (!result.ok) setError(result.message);
    else {
      const messages: Record<string, string> = {
        accepted: "SOLAPI 접수 완료. 전달 완료 여부는 발송 이력에서 확인해 주세요.",
        rejected: "SOLAPI에서 접수를 거절했습니다. 설정과 발송 이력을 확인해 주세요.",
        unknown: "접수 여부가 불명확합니다. 재발송하지 말고 발송 이력을 확인해 주세요.",
        already_started: "이미 발송 처리가 시작된 요청입니다. 발송 이력을 확인해 주세요.",
      };
      const message = messages[result.data] ?? "발송 이력을 확인해 주세요.";
      toast(message, result.data === "accepted" ? "success" : "info");
      if (result.data !== "accepted") setError(message);
    }
    await refreshHistory();
  });

  return <AdminDialog title="카톡 알림 보내기" description="회원 한 명에게 승인된 알림톡을 보냅니다. 수강권·결제 원장은 변경되지 않습니다."
    size="large" busy={busy} onClose={onClose} footer={
      <AdminDialogActions busy={busy} onClose={onClose} onSubmit={preview ? send : makePreview}
        submitLabel={preview ? "확인한 내용으로 1건 발송" : "수신번호 확인 · 미리보기"} busyLabel="확인 중…"
        disabled={!template || (needsEntitlement && !entitlement) || (!!template.paymentProductSlug && !cashConfirmed)
          || (!!preview && (!confirmed || !panel?.enabled))} />
    }>
    <div className={styles.layout}>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {!panel && <p role="status">{busy ? "승인 템플릿과 발송 이력을 불러오는 중…" : "설정을 불러오지 못했습니다."}</p>}
      {panel && <>
        <p className={styles.recipient}><strong>{panel.name}</strong><span>수신번호는 카카오에서 동의된 번호를 직접 확인합니다.</span></p>
        {!panel.enabled && <p className={styles.notice}>현재 실제 발송은 비활성화되어 있습니다. 미리보기까지 확인할 수 있습니다.</p>}
        <fieldset disabled={busy || !!preview} className={styles.fields}>
          <label htmlFor={`${fieldId}-template`}>승인 템플릿</label>
          <select id={`${fieldId}-template`} value={templateId} onChange={event => {
            setTemplateId(event.target.value); setEntitlementId(""); setValues({}); setCashConfirmed(false); invalidate();
          }}>
            <option value="">템플릿을 선택해 주세요</option>
            {panel.templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <small>연결 채널의 기본·강조 텍스트형·웹 링크 템플릿만 표시합니다.{panel.unsupported > 0 ? ` 지원되지 않거나 사용 불가한 ${panel.unsupported}개는 제외했습니다.` : ""}</small>
          {!panel.templates.length && <p className={styles.notice}>사용 가능한 승인 템플릿이 없습니다. SOLAPI에서 채널과 템플릿 상태를 확인해 주세요.</p>}
          {template && <>
            {needsEntitlement && <>
              <label htmlFor={`${fieldId}-entitlement`}>안내할 수강권</label>
              <select id={`${fieldId}-entitlement`} value={entitlementId} onChange={event => { setEntitlementId(event.target.value); setCashConfirmed(false); invalidate(); }}>
                <option value="">유효한 수강권 선택</option>
                {choices.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
              {!choices.length && <p className={styles.notice}>이 템플릿에 맞는 수강권이 없습니다. 온라인 결제 안내는 기존 자동 발송 경로에서 관리합니다.</p>}
            </>}
            {template.variables.map((name, index) => {
              const automatic = ["#{name}", "#{이름}", "#{product}"].includes(name);
              const value = ["#{name}", "#{이름}"].includes(name) ? panel.name : name === "#{product}" ? entitlement?.title ?? "" : values[name] ?? "";
              const cashDate = !!template.paymentProductSlug && name === "#{paymentDate}";
              const cashAmount = !!template.paymentProductSlug && name === "#{amount}";
              const label = ["#{name}", "#{이름}"].includes(name) ? "회원 이름" : name === "#{product}" ? "상품명" : name.slice(2, -1);
              return <div className={styles.field} key={name}>
                <label htmlFor={`${fieldId}-variable-${index}`}>{cashAmount ? "실제 입금액 (원)" : cashDate ? "실제 입금일 (한국 시간)" : label}{automatic && " · 자동 입력"}</label>
                <input id={`${fieldId}-variable-${index}`} value={value} readOnly={automatic} maxLength={500}
                  type={cashDate ? "date" : "text"} inputMode={cashAmount ? "numeric" : undefined}
                  onChange={event => { setValues(current => ({ ...current, [name]: event.target.value })); setCashConfirmed(false); invalidate(); }} />
              </div>;
            })}
            {!!template.paymentProductSlug && <>
              <p className={styles.notice}>상품 가격이나 수강권 지급일을 입금 내역으로 간주하지 않습니다. 통장 내역에서 실제 금액·입금일을 확인해 주세요.</p>
              <label className={styles.check}><input type="checkbox" checked={cashConfirmed} onChange={event => { setCashConfirmed(event.target.checked); invalidate(); }} />실제 현금 입금 금액과 날짜를 확인했습니다.</label>
            </>}
          </>}
        </fieldset>
        {preview && <section className={styles.preview} aria-label="발송 미리보기">
          <h3 ref={previewHeading} tabIndex={-1}>발송 전 최종 확인</h3>
          <p><strong>{preview.name}</strong> · {preview.maskedPhone}</p>
          <small>{preview.templateName} · 미리보기 유효시간 5분</small>
          <div className={styles.message}>
            {preview.subtitle && <p>{preview.subtitle}</p>}{preview.title && <h3>{preview.title}</h3>}
            {preview.content}{preview.extra && <><hr />{preview.extra}</>}
          </div>
          {preview.buttons.map((button, index) => <div key={index} className={styles.linkPreview}>
            <strong>{button.name}</strong><span>모바일: {button.mobile}</span>{button.desktop && <span>PC: {button.desktop}</span>}
          </div>)}
          <p className={styles.notice}>실제 알림톡 발송 시 SOLAPI 이용 요금이 발생합니다. 문자 대체 발송과 자동 재발송은 하지 않습니다.</p>
          <label className={styles.check}><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />수신자·번호·본문·버튼을 확인했습니다.</label>
          <button type="button" className={styles.secondary} disabled={busy} onClick={invalidate}>입력 내용 수정</button>
        </section>}
        <section className={styles.history} aria-label="발송 이력">
          <header><h3>최근 발송 이력</h3><button type="button" className={styles.secondary} disabled={busy} onClick={() => run(refreshHistory)}>결과 새로고침</button></header>
          <small>접수 완료는 전달 완료가 아닙니다. 최초 결과 확인은 약 2분 뒤, 이후 5분 간격입니다. 과거 가입 안내 등 SOLAPI에서만 보관된 이력도 발송 전에 별도로 확인합니다.</small>
          {!panel.history.length && <p>사이트에 기록된 발송 이력이 없습니다.</p>}
          <ul>{panel.history.map(item => <li key={`${item.source}-${item.id}`}>
            <strong>{item.templateName}</strong>
            <span>{notificationStatusLabels[item.status] ?? "확인 필요"}</span>
            <small>{formatDate(item.createdAt)} · {item.source === "admin" ? "관리자 발송" : "수강 안내 기록"}{item.deliveredAt ? ` · 전달 ${formatDate(item.deliveredAt)}` : ""}</small>
          </li>)}</ul>
          <p className={styles.notice}>동일 회원·템플릿의 중복 발송은 차단됩니다. 실패·결과 불명인 경우 SOLAPI 이력을 먼저 확인해 주세요.</p>
        </section>
      </>}
    </div>
  </AdminDialog>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
