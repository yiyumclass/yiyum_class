begin;

update public.products
set title = '역제안 템플릿',
    thumbnail_path = '/assets/resources/reverse-proposal-template-cover.png'
where slug = 'small-account-ebook'
  and product_type = 'ebook'
  and price_krw = 0
  and title = '무료 자료'
  and thumbnail_path is null;

commit;
