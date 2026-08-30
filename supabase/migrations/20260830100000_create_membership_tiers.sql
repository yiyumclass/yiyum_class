-- 하나의 SNS 수익화 원본 강의를 지원 깊이에 따라 세 가지 판매 상품으로 나눈다.
-- 카드 할부는 Toss 결제창이 처리하므로 products.price_krw에는 실제 총 결제금액만 저장한다.

begin;

do $$
begin
  if not exists (
    select 1 from public.courses where slug = 'sns-monetization'
  ) then
    raise exception 'sns-monetization course is required before creating membership tiers';
  end if;
end;
$$;

-- 기존 상품의 품절·판매 중지 상태는 운영 판단이므로 가격 마이그레이션에서 덮어쓰지 않는다.
update public.products
set
  price_krw = 930000,
  list_price_krw = null,
  access_period_days = 365,
  updated_at = now()
where slug = 'sns-monetization';

insert into public.products (
  slug,
  product_type,
  title,
  summary,
  detail_body,
  price_krw,
  list_price_krw,
  access_period_days,
  status,
  thumbnail_path,
  detail_path
)
values
  (
    'sns-monetization-feedback',
    'course',
    '피드백 클래스',
    'VOD 강의에 실전 과제, 동기 오픈카톡방과 이윰 1:1 피드백을 더한 과정',
    '혼자 적용하다 멈추지 않도록 과제와 피드백을 함께 제공합니다.',
    1200000,
    null,
    365,
    'active',
    '/assets/profile.jpg',
    null
  ),
  (
    'sns-monetization-ultra',
    'course',
    '초밀착 클래스',
    'VOD와 피드백에 10분 전화 코칭 6회를 더한 집중 과정',
    '과제와 1:1 피드백, 짧고 밀도 높은 전화 코칭을 함께 제공합니다.',
    2990000,
    null,
    365,
    'active',
    '/assets/profile.jpg',
    null
  )
on conflict (slug) do update
set
  product_type = excluded.product_type,
  title = excluded.title,
  summary = excluded.summary,
  detail_body = excluded.detail_body,
  price_krw = excluded.price_krw,
  list_price_krw = excluded.list_price_krw,
  access_period_days = excluded.access_period_days,
  thumbnail_path = excluded.thumbnail_path,
  detail_path = excluded.detail_path,
  updated_at = now();

insert into public.products (
  slug,
  product_type,
  title,
  summary,
  detail_body,
  price_krw,
  list_price_krw,
  access_period_days,
  status,
  thumbnail_path,
  detail_path
)
values (
  'yiyum-phone-pass',
  'consulting',
  '이윰 1:1 전화권',
  '계정 인사이트와 콘텐츠, 알고리즘, 수익화 고민을 짧게 함께 점검하는 1:1 전화 코칭',
  '한 번에 10분씩 총 6회 제공합니다. 구체적인 일정과 이용 방법은 결제 후 개별 안내합니다.',
  330000,
  null,
  null,
  'active',
  '/assets/profile.jpg',
  null
)
on conflict (slug) do update
set
  product_type = excluded.product_type,
  title = excluded.title,
  summary = excluded.summary,
  detail_body = excluded.detail_body,
  price_krw = excluded.price_krw,
  list_price_krw = excluded.list_price_krw,
  access_period_days = excluded.access_period_days,
  thumbnail_path = excluded.thumbnail_path,
  detail_path = excluded.detail_path,
  updated_at = now();

insert into public.product_course_scopes (product_id, course_id, access_mode, updated_at)
select product.id, course.id, 'full', now()
from public.products as product
cross join public.courses as course
where product.slug in (
    'sns-monetization',
    'sns-monetization-feedback',
    'sns-monetization-ultra'
  )
  and course.slug = 'sns-monetization'
on conflict (product_id) do update
set
  course_id = excluded.course_id,
  access_mode = 'full',
  updated_at = now();

delete from public.product_course_scope_sections
where product_id in (
  select id
  from public.products
  where slug in (
    'sns-monetization',
    'sns-monetization-feedback',
    'sns-monetization-ultra'
  )
);

-- 진도 저장 요청은 판매 상품 slug가 아니라 원본 강의 slug를 보낸다.
-- 상품-강의 범위를 기준으로 권한을 확인해 상위 등급도 진도를 저장할 수 있게 한다.
create or replace function public.has_active_course_access(target_course_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.product_entitlements as entitlement
    join public.products as product on product.id = entitlement.product_id
      and product.product_type = 'course'
      and product.status <> 'archived'
    join public.product_course_scopes as scope on scope.product_id = product.id
    join public.courses as course on course.id = scope.course_id
    where entitlement.user_id = (select auth.uid())
      and entitlement.status = 'active'
      and (entitlement.expires_at is null or entitlement.expires_at > now())
      and course.slug = target_course_slug
  );
$$;

revoke all on function public.has_active_course_access(text) from public;
grant execute on function public.has_active_course_access(text) to authenticated;

-- 배포 전에 생성된 주문도 같은 회원·멤버십 그룹에 pending이 하나만 남도록 정리한다.
update public.orders as pending_order
set status = 'failed', updated_at = now()
where pending_order.source = 'payment'
  and pending_order.status = 'pending'
  and pending_order.product_id in (
    select id from public.products
    where slug in (
      'sns-monetization',
      'sns-monetization-feedback',
      'sns-monetization-ultra'
    )
  )
  and exists (
    select 1
    from public.product_entitlements as entitlement
    join public.products as owned_product on owned_product.id = entitlement.product_id
    where entitlement.user_id = pending_order.user_id
      and entitlement.status = 'active'
      and (entitlement.expires_at is null or entitlement.expires_at > now())
      and owned_product.slug in (
        'sns-monetization',
        'sns-monetization-feedback',
        'sns-monetization-ultra'
      )
  );

with ranked_membership_orders as (
  select
    pending_order.id,
    row_number() over (
      partition by pending_order.user_id
      order by pending_order.created_at desc, pending_order.id desc
    ) as pending_rank
  from public.orders as pending_order
  join public.products as product on product.id = pending_order.product_id
  where pending_order.source = 'payment'
    and pending_order.status = 'pending'
    and product.slug in (
      'sns-monetization',
      'sns-monetization-feedback',
      'sns-monetization-ultra'
    )
)
update public.orders as pending_order
set status = 'failed', updated_at = now()
from ranked_membership_orders as ranked
where pending_order.id = ranked.id
  and ranked.pending_rank > 1;

-- 등급 변경 정책이 확정되기 전에는 같은 원본 강의를 공유하는 멤버십을
-- 여러 번 결제하지 못하게 한다. 새 pending 주문은 사용자별로 직렬화하고 기존 주문을 폐기한다.
create or replace function public.block_duplicate_membership_payment_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source = 'payment'
    and new.status = 'pending'
    and exists (
      select 1
      from public.products as target_product
      where target_product.id = new.product_id
        and target_product.slug in (
          'sns-monetization',
          'sns-monetization-feedback',
          'sns-monetization-ultra'
        )
    ) then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.user_id::text || ':sns-membership', 0)
    );

    if exists (
      select 1
      from public.product_entitlements as entitlement
      join public.products as owned_product on owned_product.id = entitlement.product_id
      where entitlement.user_id = new.user_id
        and entitlement.status = 'active'
        and (entitlement.expires_at is null or entitlement.expires_at > now())
        and owned_product.slug in (
          'sns-monetization',
          'sns-monetization-feedback',
          'sns-monetization-ultra'
        )
    ) then
      raise exception 'active membership entitlement already exists'
        using errcode = '23505';
    end if;

    if exists (
      select 1
      from public.orders as pending_order
      join public.products as pending_product on pending_product.id = pending_order.product_id
      where pending_order.user_id = new.user_id
        and pending_order.source = 'payment'
        and pending_order.status = 'pending'
        and pending_order.id is distinct from new.id
        and pending_product.slug in (
          'sns-monetization',
          'sns-monetization-feedback',
          'sns-monetization-ultra'
        )
    ) then
      raise exception 'membership payment already pending'
        using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.block_duplicate_membership_payment_order() from public;

drop trigger if exists block_duplicate_membership_payment_order_before_write
  on public.orders;
create trigger block_duplicate_membership_payment_order_before_write
before insert or update of user_id, product_id, source, status on public.orders
for each row execute function public.block_duplicate_membership_payment_order();

-- 결제 완료·관리자 지급으로 멤버십이 활성화되면 기존 pending 결제창을 즉시 무효화한다.
create or replace function public.fail_pending_membership_orders_after_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
    and (new.expires_at is null or new.expires_at > now())
    and exists (
      select 1 from public.products
      where id = new.product_id
        and slug in (
          'sns-monetization',
          'sns-monetization-feedback',
          'sns-monetization-ultra'
        )
    ) then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.user_id::text || ':sns-membership', 0)
    );

    update public.orders as pending_order
    set status = 'failed', updated_at = now()
    where pending_order.user_id = new.user_id
      and pending_order.source = 'payment'
      and pending_order.status = 'pending'
      and pending_order.product_id in (
        select id from public.products
        where slug in (
          'sns-monetization',
          'sns-monetization-feedback',
          'sns-monetization-ultra'
        )
      );
  end if;

  return new;
end;
$$;

revoke all on function public.fail_pending_membership_orders_after_entitlement() from public;

drop trigger if exists fail_pending_membership_orders_after_entitlement_write
  on public.product_entitlements;
create trigger fail_pending_membership_orders_after_entitlement_write
after insert or update of user_id, product_id, status, expires_at
on public.product_entitlements
for each row execute function public.fail_pending_membership_orders_after_entitlement();

commit;
