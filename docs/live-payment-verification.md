# 운영 100원 결제 검증

- 경로: `/checkout?product=admin-payment-verification-100`
- 활성 `owner` 관리자만 화면과 주문 생성에 접근한다. 일반 회원과 operator는 DB RPC 직접 호출도 거부된다.
- 상품은 `draft`라 공개 판매 목록에서 제외된다. DB 제약으로 가격은 100원, 상태는 draft/archived, 상품 종류는 course, 이용 기간은 1일로 제한한다.
- 기존 상품 가격과 정규 강의 권한은 변경하지 않는다. 검증 상품에는 강의가 연결되지 않는다.
- 실제 운영 키와 기존 주문 생성 → 토스 승인 → 이용권 발급 → 관리자 전액 환불 경로를 사용한다.
- 카드 인증은 사용자가 직접 진행한다. 결제창·카드 인증 화면에 표시되는 금액이 100원인지 반드시 확인한다.
- 운영 키이므로 실제 청구된다. 승인 후 토스 DONE, 주문 paid, 검증 상품 이용권 active를 확인한다.
- 사용자의 동의 범위에서 전액 취소 후 토스 CANCELED, 주문 refunded, 이용권 revoked를 확인한다. 카드사 반영 시점은 별도다.
- 소액 검증은 120만원 한도·할부 또는 모든 카드사의 승인을 보장하지 않는다.

검증 완료 후 상품만 `archived`로 변경하여 재결제를 막는다. 주문·환불 감사 이력은 삭제하지 않는다.

```sql
update public.products
set status = 'archived'
where slug = 'admin-payment-verification-100';
```
