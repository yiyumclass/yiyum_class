"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import styles from "./AccountSettings.module.css";

type AccountProfile = {
  name: string;
  nickname: string;
  email: string;
  phone: string;
  joinedAt: string;
  marketingEnabled: boolean;
};

type AccountSettingsProps = {
  profile: AccountProfile;
};

const settingNavigation = [
  { href: "#profile", label: "프로필 정보" },
  { href: "#connection", label: "연결 계정" },
  { href: "#notifications", label: "알림 설정" },
  { href: "#account-management", label: "계정 관리" },
];

export default function AccountSettings({ profile }: AccountSettingsProps) {
  const [marketingEnabled, setMarketingEnabled] = useState(
    profile.marketingEnabled
  );
  const [contentUpdatesEnabled, setContentUpdatesEnabled] = useState(true);
  const [withdrawalOpen, setWithdrawalOpen] = useState(false);
  const [withdrawalConfirm, setWithdrawalConfirm] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!withdrawalOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setWithdrawalOpen(false);
        setWithdrawalConfirm("");
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [withdrawalOpen]);

  const showPreviewNotice = (message: string) => {
    setNotice(message);
  };

  const handleProfileSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    showPreviewNotice("목업 단계로, 입력한 정보는 아직 실제 계정에 저장되지 않습니다.");
  };

  const completeWithdrawalPreview = () => {
    setWithdrawalOpen(false);
    setWithdrawalConfirm("");
    showPreviewNotice("회원 탈퇴 확인 흐름까지 미리보기로 확인했습니다.");
  };

  return (
    <>
      <section className={styles.pageHeading}>
        <div>
          <span className={styles.eyebrow}>MY ACCOUNT</span>
          <h1 className="serif">계정 설정</h1>
          <p>내 정보와 연결 계정, 알림 수신 여부를 관리합니다.</p>
        </div>
        <span className={styles.joinedAt}>가입일 {profile.joinedAt}</span>
      </section>

      <div className={styles.previewBanner}>
        <span className={styles.kakaoMiniMark} aria-hidden="true">
          <KakaoIcon />
        </span>
        <div>
          <strong>카카오 연동 기준 화면 미리보기</strong>
          <p>현재 로그인·회원가입 방식은 유지되며, 아래 저장 동작은 아직 연결되지 않았습니다.</p>
        </div>
        <span className={styles.previewBadge}>PREVIEW</span>
      </div>

      {notice && (
        <div className={styles.previewNotice} role="status">
          <InfoIcon />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="안내 닫기">
            <CloseIcon />
          </button>
        </div>
      )}

      <div className={styles.settingsLayout}>
        <aside className={styles.localNavigation} aria-label="계정 설정 목차">
          <p>ACCOUNT</p>
          <nav>
            {settingNavigation.map((item, index) => (
              <a href={item.href} key={item.href}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        <div className={styles.settingsContent}>
          <section id="profile" className={styles.settingsCard}>
            <div className={styles.cardHeading}>
              <div>
                <span className={styles.cardIndex}>01</span>
                <h2>프로필 정보</h2>
                <p>서비스에서 사용할 기본 정보를 확인하고 수정합니다.</p>
              </div>
              <span className={styles.profileAvatar} aria-hidden="true">
                {profile.nickname.slice(0, 1) || "회"}
              </span>
            </div>

            <form className={styles.profileForm} onSubmit={handleProfileSubmit}>
              <label>
                <span>이름</span>
                <input type="text" name="name" defaultValue={profile.name} />
              </label>
              <label>
                <span>닉네임</span>
                <input type="text" name="nickname" defaultValue={profile.nickname} />
              </label>
              <label>
                <span>휴대전화 번호</span>
                <input
                  type="tel"
                  name="phone"
                  defaultValue={profile.phone}
                  placeholder="01012345678"
                />
              </label>
              <label>
                <span>이메일</span>
                <span className={styles.readonlyField}>{profile.email}</span>
                <small>카카오에서 제공받은 이메일은 연결 계정에서 관리합니다.</small>
              </label>

              <div className={styles.formActions}>
                <button type="submit" className={styles.primaryButton}>
                  변경사항 저장
                </button>
              </div>
            </form>
          </section>

          <section id="connection" className={styles.settingsCard}>
            <div className={styles.cardHeadingSimple}>
              <div>
                <span className={styles.cardIndex}>02</span>
                <h2>연결 계정</h2>
                <p>로그인에 사용하는 계정과 기기 접속 상태를 확인합니다.</p>
              </div>
            </div>

            <div className={styles.connectedAccount}>
              <span className={styles.kakaoMark} aria-hidden="true">
                <KakaoIcon />
              </span>
              <span className={styles.connectionCopy}>
                <strong>카카오 계정</strong>
                <span>{profile.email}</span>
              </span>
              <span className={styles.connectedBadge}>
                <CheckIcon />
                연결됨
              </span>
            </div>

            <div className={styles.securityNote}>
              <LockIcon />
              <div>
                <strong>비밀번호는 카카오에서 관리합니다.</strong>
                <p>
                  카카오 로그인 회원에게는 별도의 이윰 클래스 비밀번호가 생성되지 않습니다.
                </p>
              </div>
            </div>

            <div className={styles.sessionList}>
              <div className={styles.sessionRow}>
                <span>
                  <strong>현재 기기</strong>
                  <span>지금 사용 중인 브라우저</span>
                </span>
                <span className={styles.currentSession}>사용 중</span>
              </div>
              <div className={styles.sessionRow}>
                <span>
                  <strong>다른 기기 로그인</strong>
                  <span>분실하거나 공용 기기에서 로그인한 경우 종료할 수 있습니다.</span>
                </span>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() =>
                    showPreviewNotice("다른 기기 로그아웃은 실제 연동 단계에서 활성화됩니다.")
                  }
                >
                  모두 로그아웃
                </button>
              </div>
            </div>
          </section>

          <section id="notifications" className={styles.settingsCard}>
            <div className={styles.cardHeadingSimple}>
              <div>
                <span className={styles.cardIndex}>03</span>
                <h2>알림 설정</h2>
                <p>새로운 콘텐츠와 혜택에 대한 소식을 받을지 선택합니다.</p>
              </div>
            </div>

            <div className={styles.preferenceList}>
              <PreferenceRow
                title="서비스 필수 안내"
                description="결제, 환불, 이용권 변경과 보안 관련 안내입니다."
                checked
                disabled
                onChange={() => undefined}
              />
              <PreferenceRow
                title="강의·전자책 업데이트"
                description="구매한 콘텐츠에 새로운 자료가 추가되면 알려드립니다."
                checked={contentUpdatesEnabled}
                onChange={() => {
                  setContentUpdatesEnabled((value) => !value);
                  showPreviewNotice("알림 설정 변경은 목업 화면에만 반영됩니다.");
                }}
              />
              <PreferenceRow
                title="혜택 및 마케팅 정보"
                description="신규 클래스, 할인과 이벤트 소식을 받아봅니다."
                checked={marketingEnabled}
                onChange={() => {
                  setMarketingEnabled((value) => !value);
                  showPreviewNotice("마케팅 수신 설정은 목업 화면에만 반영됩니다.");
                }}
              />
            </div>
          </section>

          <section id="account-management" className={styles.dangerCard}>
            <div>
              <span className={styles.cardIndex}>04</span>
              <h2>계정 관리</h2>
              <p>회원 탈퇴 시 보유한 콘텐츠와 학습 기록을 더 이상 이용할 수 없습니다.</p>
            </div>
            <button
              type="button"
              className={styles.withdrawalButton}
              onClick={() => setWithdrawalOpen(true)}
            >
              회원 탈퇴
            </button>
          </section>
        </div>
      </div>

      {withdrawalOpen && (
        <div
          className={styles.dialogBackdrop}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setWithdrawalOpen(false);
              setWithdrawalConfirm("");
            }
          }}
        >
          <section
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="withdrawal-title"
            aria-describedby="withdrawal-description"
          >
            <button
              autoFocus
              type="button"
              className={styles.dialogClose}
              onClick={() => {
                setWithdrawalOpen(false);
                setWithdrawalConfirm("");
              }}
              aria-label="회원 탈퇴 창 닫기"
            >
              <CloseIcon />
            </button>
            <span className={styles.dialogIcon} aria-hidden="true">
              !
            </span>
            <h2 id="withdrawal-title">회원 탈퇴 전 확인해 주세요</h2>
            <p id="withdrawal-description" className={styles.dialogLead}>
              탈퇴가 완료되면 이윰 클래스에 로그인할 수 없으며,
              <br />
              아래 항목은 이전 상태로 되돌리기 어렵습니다.
            </p>

            <div className={styles.withdrawalEffects}>
              <div>
                <span>이용 종료</span>
                <strong>콘텐츠와 학습 기록을 더 이상 확인할 수 없어요.</strong>
                <p>
                  강의·전자책 열람이 중단되며, 같은 카카오 계정으로 다시 가입해도 기존
                  진도와 설정은 자동 복구되지 않습니다.
                </p>
              </div>
              <div>
                <span>개인정보 파기</span>
                <strong>회원 정보는 원칙적으로 지체 없이 파기해요.</strong>
                <p>
                  다만 관계 법령에 따라 보관 의무가 있는 거래 기록은 정해진 기간 동안
                  다른 회원 정보와 분리해 보관합니다.
                </p>
              </div>
            </div>

            <div className={styles.retentionBox}>
              <div className={styles.retentionHeading}>
                <strong>법령에 따라 보관되는 거래 기록</strong>
                <span>전자상거래법 기준</span>
              </div>
              <dl>
                <div>
                  <dt>계약 또는 청약철회 등에 관한 기록</dt>
                  <dd>5년</dd>
                </div>
                <div>
                  <dt>대금결제 및 콘텐츠 공급에 관한 기록</dt>
                  <dd>5년</dd>
                </div>
                <div>
                  <dt>소비자 불만 또는 분쟁처리에 관한 기록</dt>
                  <dd>3년</dd>
                </div>
              </dl>
              <p>보관된 정보는 법정 의무 이행과 분쟁 대응 목적에만 이용합니다.</p>
            </div>

            <div className={styles.pendingNotice}>
              <InfoIcon />
              <p>
                <strong>진행 중인 환불이나 문의가 있다면 먼저 완료해 주세요.</strong>
                <span>
                  회원 탈퇴만으로 관련 법령상 소비자 권리가 사라지는 것은 아니지만,
                  처리 상태 확인을 위해 완료 후 탈퇴를 권장합니다.
                </span>
              </p>
            </div>

            <Link
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              className={styles.privacyLink}
            >
              개인정보처리방침 전체보기
              <span aria-hidden="true">↗</span>
            </Link>

            <label className={styles.confirmLabel}>
              <span className={styles.confirmInstruction}>
                계속하려면 <strong>회원탈퇴</strong>를 입력해 주세요.
              </span>
              <input
                type="text"
                value={withdrawalConfirm}
                onChange={(event) => setWithdrawalConfirm(event.target.value)}
                placeholder="회원탈퇴"
              />
            </label>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.dialogCancel}
                onClick={() => {
                  setWithdrawalOpen(false);
                  setWithdrawalConfirm("");
                }}
              >
                취소
              </button>
              <button
                type="button"
                className={styles.dialogConfirm}
                disabled={withdrawalConfirm !== "회원탈퇴"}
                onClick={completeWithdrawalPreview}
              >
                탈퇴 확인
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

type PreferenceRowProps = {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
};

function PreferenceRow({
  title,
  description,
  checked,
  disabled = false,
  onChange,
}: PreferenceRowProps) {
  return (
    <div className={styles.preferenceRow}>
      <span>
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`${title} ${checked ? "켜짐" : "꺼짐"}`}
        className={checked ? styles.switchOn : styles.switchOff}
        disabled={disabled}
        onClick={onChange}
      >
        <span />
      </button>
    </div>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9v4M10 6.5h.01" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m6 6 8 8M14 6l-8 8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5 10 3 3 7-7" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M12 14v3" />
    </svg>
  );
}

function KakaoIcon() {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true">
      <path d="M14 5.3c-5.4 0-9.8 3.4-9.8 7.6 0 2.7 1.8 5 4.5 6.4l-1.1 4 4.6-2.7c.6.1 1.2.1 1.8.1 5.4 0 9.8-3.5 9.8-7.8S19.4 5.3 14 5.3Z" />
    </svg>
  );
}
