/**
 * 판매 상품의 이행 방식. 결제 후 실제로 무엇을 주느냐로 나눈다.
 *
 * - `course` 강의실에서 VOD 재생
 * - `ebook` 전자책과 자료 파일 내려받기
 * - `consulting` 결제 후 설문 폼을 보내고 사람이 일정을 잡는 줌 1:1 세션
 *
 * 판매 페이지 생김새가 다르다는 이유만으로 유형을 늘리지 않는다. 그 차이는
 * 상세 화면에서 다루고, 이 타입은 결제·이용권이 갈리는 지점만 구분한다.
 */
export type ProductType = "course" | "ebook" | "consulting";

/**
 * 유형 이름은 한 곳에서만 짓는다. 화면마다 삼항으로 갈라 두면 유형이 늘 때
 * 새 유형이 조용히 전자책으로 표시된다. Record라 빠뜨리면 컴파일이 막는다.
 */
export const productTypeLabels: Record<ProductType, string> = {
  course: "VOD 강의",
  ebook: "전자책",
  consulting: "1:1 컨설팅",
};

export function formatProductType(type: ProductType) {
  return productTypeLabels[type];
}
