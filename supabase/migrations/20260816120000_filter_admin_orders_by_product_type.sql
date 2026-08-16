-- 주문 원장의 1차 분류를 지급 경로가 아닌 상품 유형으로 제공한다.
-- 페이지, 요약, CSV가 같은 조건을 써야 총 건수와 표시 행이 어긋나지 않는다.

drop function if exists public.get_admin_order_ledger_page(
  text, text, text, timestamptz, boolean, text, integer, integer
);
drop function if exists public.get_admin_order_ledger_summary(
  text, text, text, timestamptz, boolean
);

create function public.get_admin_order_ledger_page(
  p_search text default null,
  p_product_type text default 'all',
  p_source text default 'all',
  p_status text default 'all',
  p_since timestamptz default null,
  p_attention boolean default false,
  p_sort text default 'created_desc',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  transaction_id uuid, order_uid text, customer_id uuid, customer_name text,
  customer_email text, product_id uuid, product_slug text, product_title text,
  product_type text, source text, payment_status text, entitlement_status text,
  amount_krw integer, created_at timestamptz, approved_at timestamptz,
  refunded_at timestamptz, expires_at timestamptz, payment_key_present boolean,
  refund_status text, refund_amount integer, total_lessons bigint,
  started_lessons bigint, completed_lessons bigint, watched_seconds bigint,
  progress_percent numeric, first_watched_at timestamptz,
  last_watched_at timestamptz, total_count bigint
)
language sql stable security definer set search_path = ''
as $$
  with filtered as (
    select *
    from public.admin_order_ledger_base(
      p_search, p_source, p_status, p_since, p_attention
    ) base
    where p_product_type is null
      or p_product_type = 'all'
      or base.product_type = p_product_type
  ), counted as (
    select filtered.*, count(*) over () as total_count from filtered
  ), page as (
    select * from counted
    order by
      case when p_sort = 'amount_desc' then counted.amount_krw end desc nulls last,
      case when p_sort = 'amount_asc' then counted.amount_krw end asc nulls last,
      case when p_sort = 'created_asc' then counted.created_at end asc,
      counted.created_at desc
    limit greatest(coalesce(p_limit, 25), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    page.transaction_id, page.order_uid, page.customer_id, page.customer_name,
    page.customer_email, page.product_id, page.product_slug, page.product_title,
    page.product_type, page.source, page.payment_status, page.entitlement_status,
    page.amount_krw, page.created_at, page.approved_at, page.refunded_at,
    page.expires_at, page.payment_key_present, page.refund_status, page.refund_amount,
    coalesce(learning.total_lessons, 0), coalesce(learning.started_lessons, 0),
    coalesce(learning.completed_lessons, 0), coalesce(learning.watched_seconds, 0),
    coalesce(learning.progress_percent, 0), learning.first_watched_at,
    learning.last_watched_at, page.total_count
  from page
  left join lateral public.admin_order_learning_stats(
    page.customer_id, page.product_id
  ) learning on page.product_type = 'course'
  order by
    case when p_sort = 'amount_desc' then page.amount_krw end desc nulls last,
    case when p_sort = 'amount_asc' then page.amount_krw end asc nulls last,
    case when p_sort = 'created_asc' then page.created_at end asc,
    page.created_at desc;
$$;

create function public.get_admin_order_ledger_summary(
  p_search text default null,
  p_product_type text default 'all',
  p_source text default 'all',
  p_status text default 'all',
  p_since timestamptz default null,
  p_attention boolean default false
)
returns table (
  total_orders bigint,
  today_orders bigint,
  active_entitlements bigint,
  paid_amount bigint,
  attention_total bigint
)
language sql stable security definer set search_path = ''
as $$
  with filtered as (
    select *
    from public.admin_order_ledger_base(
      p_search, p_source, p_status, p_since, p_attention
    ) base
    where p_product_type is null
      or p_product_type = 'all'
      or base.product_type = p_product_type
  ), seoul_today as (
    select (date_trunc('day', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul' as starts_at
  )
  select
    (select count(*) from filtered)::bigint,
    (select count(*) from filtered, seoul_today where filtered.created_at >= seoul_today.starts_at)::bigint,
    (select count(*) from filtered where filtered.entitlement_status = 'active')::bigint,
    (select coalesce(sum(filtered.amount_krw), 0) from filtered where filtered.payment_status = 'paid')::bigint,
    (select count(*) from public.admin_order_ledger_base(null, 'all', 'all', null, true))::bigint;
$$;

revoke all on function public.get_admin_order_ledger_page(
  text, text, text, text, timestamptz, boolean, text, integer, integer
) from anon;
revoke all on function public.get_admin_order_ledger_summary(
  text, text, text, text, timestamptz, boolean
) from anon;

grant execute on function public.get_admin_order_ledger_page(
  text, text, text, text, timestamptz, boolean, text, integer, integer
) to authenticated;
grant execute on function public.get_admin_order_ledger_summary(
  text, text, text, text, timestamptz, boolean
) to authenticated;
