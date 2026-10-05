begin;

update public.products as product
set title = names.title
from (
  values
    ('sns-monetization', '이윰 SNS 수익화 클래스', '베이직 클래스'),
    ('sns-monetization-feedback', '피드백 클래스', '부스터 클래스'),
    ('sns-monetization-ultra', '초밀착 클래스', '프리미엄 클래스')
) as names(slug, previous_title, title)
where product.slug = names.slug
  and product.product_type = 'course'
  and product.title = names.previous_title;

commit;
