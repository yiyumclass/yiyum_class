// 감사 로그 표기. 대시보드와 전체 조회 화면이 같은 문구를 써야 하므로 한곳에 둔다.

const ACTION_LABELS: Record<string, string> = {
  "product.created": "상품을 등록했습니다",
  "product.updated": "상품 정보를 변경했습니다",
  "courses.created": "강의를 연결했습니다",
  "courses.updated": "강의 정보를 변경했습니다",
  "course_sections.created": "챕터를 추가했습니다",
  "course_sections.updated": "챕터를 변경했습니다",
  "lessons.created": "차시를 추가했습니다",
  "lessons.updated": "차시를 변경했습니다",
  "entitlement.granted": "수강권을 지급했습니다",
  "entitlement.updated": "수강권을 변경했습니다",
  "entitlement.revoked": "수강권을 회수했습니다",
  "payment.refund_requested": "환불 처리를 시작했습니다",
  "payment.refunded": "결제를 환불했습니다",
  "admin_user.granted": "운영자 권한을 부여했습니다",
  "admin_user.revoked": "운영자 권한을 해제했습니다",
};

const TARGET_LABELS: Record<string, string> = {
  product: "상품",
  products: "상품",
  courses: "강의",
  course_sections: "챕터",
  lessons: "차시",
  product_entitlements: "수강권",
  payment_refunds: "환불",
  order: "주문",
  orders: "주문",
  admin_user: "운영자",
  admin_users: "운영자",
};

// 변경 유형 필터의 선택지. 라벨 표와 목록이 어긋나면 고를 수 없는 값이 생기므로
// 표에서 그대로 뽑는다.
export const AUDIT_ACTIONS = Object.keys(ACTION_LABELS);

export function isAuditAction(value: string | undefined): value is string {
  return typeof value === "string" && value in ACTION_LABELS;
}

export function formatAuditAction(action: string) {
  return ACTION_LABELS[action] ?? "운영 정보를 변경했습니다";
}

export function formatAuditTarget(targetType: string) {
  return TARGET_LABELS[targetType] ?? "변경";
}

// 대시보드용 축약 표기. 좁은 목록에 들어가므로 연도를 뺀다.
export function formatAdminDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

const METADATA_FIELD_LABELS: Record<string, string> = {
  slug: "식별자",
  title: "제목",
  summary: "소개",
  price_krw: "가격(원)",
  access_period_days: "수강 기간(일)",
  status: "상태",
  thumbnail_path: "썸네일 경로",
  detail_path: "상세 이미지 경로",
  product_id: "상품 ID",
  product_title: "상품명",
  product_type: "상품 유형",
  member_email: "회원 이메일",
  member_name: "회원명",
  order_uid: "주문번호",
  refund_uid: "환불번호",
  refund_amount: "환불 금액(원)",
  amount_krw: "결제 금액(원)",
  payment_status: "결제 상태",
  entitlement_status: "수강권 상태",
  lesson_key: "차시",
  section_key: "챕터",
  video_path: "영상 경로",
  expires_at: "만료일",
  granted_at: "지급일",
  reason: "사유",
  role: "역할",
  previous_role: "이전 역할",
  display_name: "표시 이름",
  is_active: "활성 여부",
  source: "경로",
  id: "ID",
  created_at: "생성 시각",
  updated_at: "수정 시각",
};

export function formatAuditField(key: string) {
  return METADATA_FIELD_LABELS[key] ?? key;
}

/** 표에 한 칸으로 들어갈 수 있게, 어떤 JSON 값이든 문자열 하나로 만든다. */
export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (typeof value === "number") return value.toLocaleString("ko-KR");
  if (typeof value === "string") return value.length > 0 ? value : "—";
  return JSON.stringify(value);
}

export type AuditMetadataRow = {
  key: string;
  label: string;
  before: string | null;
  after: string;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * metadata를 표 한 벌로 편다.
 *
 * 트리거가 남기는 모양이 액션마다 달라(어떤 것은 before/after 쌍, 어떤 것은
 * 평평한 키-값) 특정 액션에 맞춘 분기 대신 두 모양을 모두 같은 행 배열로 만든다.
 * 값은 문자열로만 다룬다 — 감사 로그는 사용자 입력이 그대로 실려오는 자리다.
 */
export function describeAuditMetadata(metadata: Record<string, unknown>): AuditMetadataRow[] {
  const before = toRecord(metadata.before);
  const after = toRecord(metadata.after);
  const rows: AuditMetadataRow[] = [];

  if (before || after) {
    const keys = Array.from(
      new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
    );
    for (const key of keys) {
      const beforeValue = before ? formatAuditValue(before[key]) : null;
      const afterValue = formatAuditValue(after?.[key]);
      // 안 바뀐 값까지 다 보여주면 정작 바뀐 줄이 묻힌다.
      if (beforeValue !== null && beforeValue === afterValue) continue;
      rows.push({ key, label: formatAuditField(key), before: beforeValue, after: afterValue });
    }
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (key === "before" || key === "after") continue;
    rows.push({
      key,
      label: formatAuditField(key),
      before: null,
      after: formatAuditValue(value),
    });
  }

  return rows;
}

// 감사 조회용 전체 표기. 사후 추적에는 연도와 초까지 필요하다.
export function formatAuditTimestamp(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
