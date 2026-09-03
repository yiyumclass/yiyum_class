/**
 * 진도 API는 상품 단위 권한과 원본 강의 단위 저장 키를 함께 받는다.
 * 챕터 상품은 두 slug가 다르므로, 상품 slug가 없을 때만 구형 요청과의
 * 호환을 위해 원본 강의 slug로 되돌린다.
 */
export function resolveProgressProductSlug(
  courseSlug: string,
  productSlug: unknown
) {
  return typeof productSlug === "string" && productSlug.trim()
    ? productSlug.trim()
    : courseSlug;
}
