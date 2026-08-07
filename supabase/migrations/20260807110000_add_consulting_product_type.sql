-- 줌 라이브 1:1 컨설팅은 VOD도 파일도 아니다. 결제 후 설문 폼을 보내고 사람이
-- 일정을 잡는다. 이행 방식이 다르므로 유형을 나눈다. 판매 페이지 생김새가
-- 다르다는 이유만으로는 유형을 늘리지 않는다.

alter table public.products drop constraint if exists products_product_type_check;
alter table public.products add constraint products_product_type_check
  check (product_type in ('course', 'ebook', 'consulting'));

comment on column public.products.product_type is
  'course VOD 강의, ebook 전자책·자료 파일, consulting 줌 라이브 1:1 컨설팅.';
