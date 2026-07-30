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
