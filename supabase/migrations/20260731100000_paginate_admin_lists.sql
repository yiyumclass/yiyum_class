-- 관리자 목록을 서버에서 거르고 정렬하고 자른다.
--
-- 기존 get_admin_* 목록 함수는 인자가 없어 전량을 반환했고, 화면이 브라우저에서
-- 걸러 25행만 그렸다. 렌더 비용만 줄고 전송량과 서버 메모리는 그대로라, 행이 쌓이면
-- 목록 화면부터 무너진다. 여기서 검색·필터·정렬·페이지를 SQL로 내린다.
--
-- 기존 함수는 지우지 않는다. CSV 내보내기처럼 걸러진 전체가 필요한 자리와
-- 롤백 경로가 남아 있어야 한다.
--
-- 요약 카드도 함께 옮긴다. 페이지만 받으면 화면이 요약을 계산할 수 없고, 보이는
-- 25행만으로 집계하면 "확인된 결제액"이 페이지마다 달라져 오독을 만든다.

-- ---------------------------------------------------------------------------
-- 이행 확인 필요 판정
-- ---------------------------------------------------------------------------

-- src/lib/admin/order-fulfillment.ts의 detectFulfillmentIssue와 같은 규칙이다.
-- 목록을 서버에서 거르려면 SQL에도 있어야 한다. 두 곳이 갈라지면 화면의 배지와
-- 필터 결과가 어긋나므로, 규칙을 바꿀 때는 반드시 양쪽을 함께 고친다.
-- (TS 쪽은 tests/order-fulfillment.test.ts가 고정하고 있다.)
create or replace function public.admin_fulfillment_issue(
  p_source text,
  p_payment_status text,
  p_entitlement_status text,
  p_payment_key_present boolean,
  p_refund_status text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_source is distinct from 'payment' then null
    when p_payment_key_present
      and p_payment_status in ('pending', 'failed') then 'approved-not-fulfilled'
    when p_payment_status = 'paid'
      and p_entitlement_status is distinct from 'active' then 'paid-without-entitlement'
    when p_refund_status = 'failed' then 'refund-needs-review'
    else null
  end;
$$;

comment on function public.admin_fulfillment_issue(text, text, text, boolean, text) is
  '결제는 끝났는데 이용권이 없는 주문을 가려낸다. src/lib/admin/order-fulfillment.ts와 규칙을 맞춰 유지해야 한다.';

-- ---------------------------------------------------------------------------
-- 주문 한 건의 학습 집계
-- ---------------------------------------------------------------------------

-- 페이지에 실제로 실리는 행에 대해서만 부르려고 따로 뺀다. 차시와 시청 기록을
-- 훑는 가장 비싼 연산이라, 거르기 전 전체 행에 대해 돌리면 페이지를 나눈 의미가 없다.
create or replace function public.admin_order_learning_stats(
  p_user_id uuid,
  p_course_id uuid,
  p_course_slug text
)
returns table (
  total_lessons bigint,
  started_lessons bigint,
  completed_lessons bigint,
  watched_seconds bigint,
  progress_percent numeric,
  first_watched_at timestamptz,
  last_watched_at timestamptz
)
language sql
stable
parallel safe
set search_path = ''
as $$
  select
    count(lesson.lesson_key)::bigint,
    count(progress.lesson_id) filter (
      where progress.max_position_seconds > 0
        or progress.first_completed_at is not null
    )::bigint,
    count(progress.lesson_id) filter (
      where progress.first_completed_at is not null
    )::bigint,
    coalesce(sum(progress.max_position_seconds), 0)::bigint,
    case
      when count(lesson.lesson_key) = 0 then 0::numeric
      else round(
        (
          coalesce(sum(
            case
              when progress.first_completed_at is not null then 1::numeric
              when progress.lesson_id is null then 0::numeric
              else least(
                0.99::numeric,
                greatest(
                  0::numeric,
                  progress.max_position_seconds::numeric /
                    nullif(coalesce(nullif(progress.duration_seconds, 0), lesson.duration_seconds), 0)
                )
              )
            end
          ), 0) / count(lesson.lesson_key)::numeric
        ) * 100,
        1
      )
    end,
    min(progress.first_watched_at),
    max(progress.last_watched_at)
  from public.course_sections as section
  join public.lessons as lesson
    on lesson.section_id = section.id
   and lesson.status = 'published'
   and lesson.video_path is not null
  left join public.lesson_progress as progress
    on progress.user_id = p_user_id
   and progress.course_slug = p_course_slug
   and progress.lesson_id = lesson.lesson_key
  where section.course_id = p_course_id
    and section.status = 'published';
$$;

-- ---------------------------------------------------------------------------
-- 주문 목록
-- ---------------------------------------------------------------------------

-- 거르기까지만 담당하는 뷰 성격의 함수. 목록과 요약이 같은 조건을 보게 하려고
-- 한곳에 둔다. 학습 집계는 여기 없다.
create or replace function public.admin_order_ledger_base(
  p_search text default null,
  p_source text default 'all',
  p_status text default 'all',
  p_since timestamptz default null,
  p_attention boolean default false
)
returns table (
  transaction_id uuid,
  order_uid text,
  customer_id uuid,
  customer_name text,
  customer_email text,
  product_id uuid,
  product_slug text,
  product_title text,
  product_type text,
  course_id uuid,
  course_slug text,
  source text,
  payment_status text,
  entitlement_status text,
  amount_krw integer,
  created_at timestamptz,
  approved_at timestamptz,
  refunded_at timestamptz,
  expires_at timestamptz,
  payment_key_present boolean,
  refund_status text,
  refund_amount integer,
  fulfillment_issue text
)
language sql
stable
security definer
set search_path = ''
as $$
  with resolved as (
    select
      orders.id as transaction_id,
      orders.order_uid,
      orders.user_id as customer_id,
      coalesce(
        nullif(account.raw_user_meta_data ->> 'nickname', ''),
        nullif(account.raw_user_meta_data ->> 'name', ''),
        nullif(split_part(coalesce(account.email, ''), '@', 1), ''),
        '이름 미등록'
      ) as customer_name,
      coalesce(account.email, '이메일 정보 없음') as customer_email,
      product.id as product_id,
      product.slug as product_slug,
      product.title as product_title,
      product.product_type,
      course.id as course_id,
      course.slug as course_slug,
      orders.source,
      orders.status as payment_status,
      case
        when entitlement.status = 'active'
          and (entitlement.expires_at is null or entitlement.expires_at > now())
          then 'active'
        else 'revoked'
      end as entitlement_status,
      orders.amount as amount_krw,
      orders.created_at,
      orders.approved_at,
      case when orders.status = 'refunded' then orders.canceled_at else null end as refunded_at,
      entitlement.expires_at,
      orders.payment_key is not null as payment_key_present,
      latest_refund.status as refund_status,
      latest_refund.amount as refund_amount
    from public.orders as orders
    join public.products as product on product.id = orders.product_id
    join auth.users as account on account.id = orders.user_id
    left join public.product_entitlements as entitlement
      on entitlement.user_id = orders.user_id
     and entitlement.product_id = orders.product_id
    left join public.courses as course
      on course.product_id = product.id
    left join lateral (
      select refund.status, refund.amount
      from public.payment_refunds as refund
      where refund.order_id = orders.id
      order by refund.requested_at desc
      limit 1
    ) as latest_refund on true
    where public.is_admin()
  )
  select
    resolved.*,
    public.admin_fulfillment_issue(
      resolved.source,
      resolved.payment_status,
      resolved.entitlement_status,
      resolved.payment_key_present,
      resolved.refund_status
    ) as fulfillment_issue
  from resolved
  where (
      p_search is null or btrim(p_search) = ''
      or resolved.customer_name ilike '%' || btrim(p_search) || '%'
      or resolved.customer_email ilike '%' || btrim(p_search) || '%'
      or resolved.product_title ilike '%' || btrim(p_search) || '%'
      or resolved.order_uid ilike '%' || btrim(p_search) || '%'
      or resolved.transaction_id::text ilike '%' || btrim(p_search) || '%'
    )
    and (p_source is null or p_source = 'all' or resolved.source = p_source)
    and (p_status is null or p_status = 'all' or resolved.entitlement_status = p_status)
    and (p_since is null or resolved.created_at >= p_since)
    and (
      not coalesce(p_attention, false)
      or public.admin_fulfillment_issue(
           resolved.source,
           resolved.payment_status,
           resolved.entitlement_status,
           resolved.payment_key_present,
           resolved.refund_status
         ) is not null
    );
$$;

-- 목록 한 페이지. 학습 집계는 잘라낸 뒤에만 붙인다.
--
-- 진도율 정렬은 일부러 두지 않는다. 진도로 정렬하려면 자르기 전 전체 행에
-- 학습 집계를 돌려야 해서 페이지를 나눈 이점이 사라진다. 진도 기준 조회는
-- 그 목적으로 만든 학습 현황 화면에 있다.
create or replace function public.get_admin_order_ledger_page(
  p_search text default null,
  p_source text default 'all',
  p_status text default 'all',
  p_since timestamptz default null,
  p_attention boolean default false,
  p_sort text default 'created_desc',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  transaction_id uuid,
  order_uid text,
  customer_id uuid,
  customer_name text,
  customer_email text,
  product_id uuid,
  product_slug text,
  product_title text,
  product_type text,
  source text,
  payment_status text,
  entitlement_status text,
  amount_krw integer,
  created_at timestamptz,
  approved_at timestamptz,
  refunded_at timestamptz,
  expires_at timestamptz,
  payment_key_present boolean,
  refund_status text,
  refund_amount integer,
  total_lessons bigint,
  started_lessons bigint,
  completed_lessons bigint,
  watched_seconds bigint,
  progress_percent numeric,
  first_watched_at timestamptz,
  last_watched_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with filtered as (
    select * from public.admin_order_ledger_base(
      p_search, p_source, p_status, p_since, p_attention
    )
  ),
  counted as (
    select filtered.*, count(*) over () as total_count
    from filtered
  ),
  page as (
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
    page.transaction_id,
    page.order_uid,
    page.customer_id,
    page.customer_name,
    page.customer_email,
    page.product_id,
    page.product_slug,
    page.product_title,
    page.product_type,
    page.source,
    page.payment_status,
    page.entitlement_status,
    page.amount_krw,
    page.created_at,
    page.approved_at,
    page.refunded_at,
    page.expires_at,
    page.payment_key_present,
    page.refund_status,
    page.refund_amount,
    coalesce(learning.total_lessons, 0),
    coalesce(learning.started_lessons, 0),
    coalesce(learning.completed_lessons, 0),
    coalesce(learning.watched_seconds, 0),
    coalesce(learning.progress_percent, 0),
    learning.first_watched_at,
    learning.last_watched_at,
    page.total_count
  from page
  left join lateral public.admin_order_learning_stats(
    page.customer_id, page.course_id, page.course_slug
  ) as learning on page.course_id is not null
  order by
    case when p_sort = 'amount_desc' then page.amount_krw end desc nulls last,
    case when p_sort = 'amount_asc' then page.amount_krw end asc nulls last,
    case when p_sort = 'created_asc' then page.created_at end asc,
    page.created_at desc;
$$;

-- 요약 카드. 목록과 같은 필터를 받아 걸러진 전체를 집계한다.
-- attention만 필터를 무시하고 전체를 세는데, 화면이 "전체 기준"이라고 밝히고 쓴다.
create or replace function public.get_admin_order_ledger_summary(
  p_search text default null,
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
language sql
stable
security definer
set search_path = ''
as $$
  with filtered as (
    select * from public.admin_order_ledger_base(
      p_search, p_source, p_status, p_since, p_attention
    )
  ),
  seoul_today as (
    select (date_trunc('day', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul' as starts_at
  )
  select
    (select count(*) from filtered)::bigint,
    (select count(*) from filtered, seoul_today where filtered.created_at >= seoul_today.starts_at)::bigint,
    (select count(*) from filtered where filtered.entitlement_status = 'active')::bigint,
    (select coalesce(sum(filtered.amount_krw), 0) from filtered where filtered.payment_status = 'paid')::bigint,
    (select count(*) from public.admin_order_ledger_base(null, 'all', 'all', null, true))::bigint;
$$;

-- ---------------------------------------------------------------------------
-- 회원 목록
-- ---------------------------------------------------------------------------

-- 회원 단위로 거른다. 수강권은 회원에 딸린 목록이라 행 단위로 자르면
-- 한 회원의 수강권이 페이지 경계에서 잘린다.
create or replace function public.admin_member_base(
  p_search text default null,
  p_filter text default 'all'
)
returns table (
  member_id uuid,
  member_email text,
  member_name text,
  joined_at timestamptz,
  last_sign_in_at timestamptz,
  active_entitlements bigint,
  expiring_entitlements bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select
      account.id as member_id,
      coalesce(account.email, '이메일 정보 없음') as member_email,
      coalesce(
        nullif(account.raw_user_meta_data ->> 'nickname', ''),
        nullif(account.raw_user_meta_data ->> 'name', ''),
        nullif(split_part(coalesce(account.email, ''), '@', 1), ''),
        '이름 미등록'
      ) as member_name,
      account.created_at as joined_at,
      account.last_sign_in_at,
      coalesce(counts.active_entitlements, 0) as active_entitlements,
      coalesce(counts.expiring_entitlements, 0) as expiring_entitlements
    from auth.users as account
    left join lateral (
      select
        count(*) filter (
          where entitlement.status = 'active'
            and (entitlement.expires_at is null or entitlement.expires_at > now())
        )::bigint as active_entitlements,
        count(*) filter (
          where entitlement.status = 'active'
            and entitlement.expires_at is not null
            and entitlement.expires_at > now()
            and entitlement.expires_at <= now() + interval '30 days'
        )::bigint as expiring_entitlements
      from public.product_entitlements as entitlement
      where entitlement.user_id = account.id
    ) as counts on true
    where public.is_admin()
      and account.deleted_at is null
  )
  select * from members
  where (
      p_search is null or btrim(p_search) = ''
      or members.member_name ilike '%' || btrim(p_search) || '%'
      or members.member_email ilike '%' || btrim(p_search) || '%'
      or members.member_id::text ilike '%' || btrim(p_search) || '%'
    )
    and (
      p_filter is null or p_filter = 'all'
      or (p_filter = 'entitled' and members.active_entitlements > 0)
      or (p_filter = 'unentitled' and members.active_entitlements = 0)
      or (p_filter = 'expiring' and members.expiring_entitlements > 0)
    );
$$;

create or replace function public.get_admin_member_entitlements_page(
  p_search text default null,
  p_filter text default 'all',
  p_sort text default 'joined_desc',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  member_id uuid,
  member_email text,
  member_name text,
  joined_at timestamptz,
  last_sign_in_at timestamptz,
  entitlement_id uuid,
  product_id uuid,
  product_title text,
  product_type text,
  entitlement_source text,
  entitlement_status text,
  granted_at timestamptz,
  expires_at timestamptz,
  access_period_days integer,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with filtered as (
    select * from public.admin_member_base(p_search, p_filter)
  ),
  counted as (
    select filtered.*, count(*) over () as total_count
    from filtered
  ),
  page as (
    select * from counted
    order by
      case when p_sort = 'joined_asc' then counted.joined_at end asc,
      case when p_sort = 'name' then counted.member_name end asc,
      case when p_sort = 'entitlements_desc' then counted.active_entitlements end desc,
      case when p_sort = 'signin_desc' then counted.last_sign_in_at end desc nulls last,
      counted.joined_at desc
    limit greatest(coalesce(p_limit, 25), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    page.member_id,
    page.member_email,
    page.member_name,
    page.joined_at,
    page.last_sign_in_at,
    entitlement.id,
    product.id,
    product.title,
    product.product_type,
    entitlement.source,
    entitlement.status,
    entitlement.granted_at,
    entitlement.expires_at,
    product.access_period_days,
    page.total_count
  from page
  left join public.product_entitlements as entitlement
    on entitlement.user_id = page.member_id
  left join public.products as product
    on product.id = entitlement.product_id
  order by
    case when p_sort = 'joined_asc' then page.joined_at end asc,
    case when p_sort = 'name' then page.member_name end asc,
    case when p_sort = 'entitlements_desc' then page.active_entitlements end desc,
    case when p_sort = 'signin_desc' then page.last_sign_in_at end desc nulls last,
    page.joined_at desc,
    entitlement.granted_at desc nulls last;
$$;

create or replace function public.get_admin_member_summary(
  p_search text default null,
  p_filter text default 'all'
)
returns table (
  total_members bigint,
  active_entitlements bigint,
  new_members bigint,
  expiring_entitlements bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with filtered as (
    select * from public.admin_member_base(p_search, p_filter)
  )
  select
    (select count(*) from filtered)::bigint,
    (select coalesce(sum(filtered.active_entitlements), 0) from filtered)::bigint,
    (select count(*) from filtered where filtered.joined_at >= now() - interval '30 days')::bigint,
    (select coalesce(sum(filtered.expiring_entitlements), 0) from filtered)::bigint;
$$;

-- ---------------------------------------------------------------------------
-- 학습 현황
-- ---------------------------------------------------------------------------

create or replace function public.admin_learning_progress_base(
  p_search text default null,
  p_status text default 'all',
  p_course_id uuid default null
)
returns table (
  member_id uuid,
  member_email text,
  member_name text,
  entitlement_id uuid,
  course_id uuid,
  course_slug text,
  course_title text,
  total_lessons bigint,
  started_lessons bigint,
  completed_lessons bigint,
  watched_seconds bigint,
  progress_percent numeric,
  last_watched_at timestamptz,
  last_lesson_key text,
  last_lesson_title text,
  learning_state text,
  needs_attention boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with eligible_enrollments as (
    select
      entitlement.id as entitlement_id,
      account.id as member_id,
      coalesce(account.email, '이메일 정보 없음') as member_email,
      coalesce(
        nullif(account.raw_user_meta_data ->> 'nickname', ''),
        nullif(account.raw_user_meta_data ->> 'name', ''),
        nullif(split_part(coalesce(account.email, ''), '@', 1), ''),
        '이름 미등록'
      ) as member_name,
      course.id as course_id,
      course.slug as course_slug,
      course.title as course_title
    from public.product_entitlements as entitlement
    join auth.users as account on account.id = entitlement.user_id
    join public.courses as course on course.product_id = entitlement.product_id
    where public.is_admin()
      and account.deleted_at is null
      and entitlement.status = 'active'
      and (entitlement.expires_at is null or entitlement.expires_at > now())
      and course.status = 'published'
      and (p_course_id is null or course.id = p_course_id)
  ),
  available_lessons as (
    select
      course.id as course_id,
      course.slug as course_slug,
      lesson.lesson_key,
      lesson.title,
      lesson.duration_seconds
    from public.courses as course
    join public.course_sections as section on section.course_id = course.id
    join public.lessons as lesson on lesson.section_id = section.id
    where course.status = 'published'
      and section.status = 'published'
      and lesson.status = 'published'
      and lesson.video_path is not null
  ),
  aggregated_progress as (
    select
      enrollment.entitlement_id,
      enrollment.member_id,
      enrollment.member_email,
      enrollment.member_name,
      enrollment.course_id,
      enrollment.course_slug,
      enrollment.course_title,
      count(lesson.lesson_key)::bigint as total_lessons,
      count(progress.lesson_id) filter (
        where progress.last_position_seconds > 0
          or progress.completed_at is not null
      )::bigint as started_lessons,
      count(progress.lesson_id) filter (
        where progress.completed_at is not null
      )::bigint as completed_lessons,
      coalesce(sum(progress.last_position_seconds), 0)::bigint as watched_seconds,
      case
        when count(lesson.lesson_key) = 0 then 0::numeric
        else round(
          (
            sum(
              case
                when progress.completed_at is not null then 1::numeric
                when progress.lesson_id is null then 0::numeric
                else least(
                  0.99::numeric,
                  greatest(
                    0::numeric,
                    progress.last_position_seconds::numeric /
                      nullif(
                        coalesce(
                          nullif(progress.duration_seconds, 0),
                          nullif(lesson.duration_seconds, 0)
                        ),
                        0
                      )
                  )
                )
              end
            ) / count(lesson.lesson_key)::numeric
          ) * 100,
          1
        )
      end as progress_percent,
      max(progress.last_watched_at) as last_watched_at
    from eligible_enrollments as enrollment
    left join available_lessons as lesson
      on lesson.course_id = enrollment.course_id
    left join public.lesson_progress as progress
      on progress.user_id = enrollment.member_id
     and progress.course_slug = enrollment.course_slug
     and progress.lesson_id = lesson.lesson_key
    group by
      enrollment.entitlement_id,
      enrollment.member_id,
      enrollment.member_email,
      enrollment.member_name,
      enrollment.course_id,
      enrollment.course_slug,
      enrollment.course_title
  ),
  latest_lessons as (
    -- products:courses = 1:1 (courses.product_id UNIQUE) 가정에 의존한다.
    select distinct on (enrollment.entitlement_id)
      enrollment.entitlement_id,
      progress.lesson_id as last_lesson_key,
      lesson.title as last_lesson_title
    from eligible_enrollments as enrollment
    join public.lesson_progress as progress
      on progress.user_id = enrollment.member_id
     and progress.course_slug = enrollment.course_slug
    join available_lessons as lesson
      on lesson.course_id = enrollment.course_id
     and lesson.lesson_key = progress.lesson_id
    order by enrollment.entitlement_id, progress.last_watched_at desc
  ),
  labeled as (
    select
      aggregate.member_id,
      aggregate.member_email,
      aggregate.member_name,
      aggregate.entitlement_id,
      aggregate.course_id,
      aggregate.course_slug,
      aggregate.course_title,
      aggregate.total_lessons,
      aggregate.started_lessons,
      aggregate.completed_lessons,
      aggregate.watched_seconds,
      coalesce(aggregate.progress_percent, 0) as progress_percent,
      aggregate.last_watched_at,
      latest.last_lesson_key,
      latest.last_lesson_title,
      -- 화면(getLearningState)과 같은 판정이다. 필터를 SQL로 내리려면 여기 있어야 한다.
      case
        when aggregate.total_lessons > 0
          and aggregate.completed_lessons >= aggregate.total_lessons then 'completed'
        when aggregate.last_watched_at is null
          and aggregate.started_lessons = 0 then 'not_started'
        else 'in_progress'
      end as learning_state
    from aggregated_progress as aggregate
    left join latest_lessons as latest
      on latest.entitlement_id = aggregate.entitlement_id
  ),
  scored as (
    select
      labeled.*,
      -- 완료가 아니면서 아직 안 봤거나 마지막 학습이 14일을 넘긴 경우
      case
        when labeled.learning_state = 'completed' then false
        when labeled.last_watched_at is null then true
        else labeled.last_watched_at < now() - interval '14 days'
      end as needs_attention
    from labeled
  )
  select * from scored
  where (
      p_search is null or btrim(p_search) = ''
      or scored.member_name ilike '%' || btrim(p_search) || '%'
      or scored.member_email ilike '%' || btrim(p_search) || '%'
      or scored.course_title ilike '%' || btrim(p_search) || '%'
    )
    and (
      p_status is null or p_status = 'all'
      or (p_status = 'attention' and scored.needs_attention)
      or (p_status <> 'attention' and scored.learning_state = p_status)
    );
$$;

create or replace function public.get_admin_learning_progress_page(
  p_search text default null,
  p_status text default 'all',
  p_course_id uuid default null,
  p_sort text default 'recent',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  member_id uuid,
  member_email text,
  member_name text,
  entitlement_id uuid,
  course_id uuid,
  course_slug text,
  course_title text,
  total_lessons bigint,
  started_lessons bigint,
  completed_lessons bigint,
  watched_seconds bigint,
  progress_percent numeric,
  last_watched_at timestamptz,
  last_lesson_key text,
  last_lesson_title text,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with filtered as (
    select * from public.admin_learning_progress_base(p_search, p_status, p_course_id)
  ),
  counted as (
    select filtered.*, count(*) over () as total_count
    from filtered
  )
  select
    counted.member_id,
    counted.member_email,
    counted.member_name,
    counted.entitlement_id,
    counted.course_id,
    counted.course_slug,
    counted.course_title,
    counted.total_lessons,
    counted.started_lessons,
    counted.completed_lessons,
    counted.watched_seconds,
    counted.progress_percent,
    counted.last_watched_at,
    counted.last_lesson_key,
    counted.last_lesson_title,
    counted.total_count
  from counted
  order by
    case when p_sort = 'progress_low' then counted.progress_percent end asc,
    case when p_sort = 'progress_high' then counted.progress_percent end desc,
    case when p_sort = 'lesson_low' then counted.completed_lessons end asc,
    case when p_sort = 'lesson_high' then counted.completed_lessons end desc,
    case when p_sort = 'name' then counted.member_name end asc,
    case when p_sort = 'oldest' then counted.last_watched_at end asc nulls first,
    counted.last_watched_at desc nulls last,
    counted.member_name
  limit greatest(coalesce(p_limit, 25), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.get_admin_learning_summary(
  p_search text default null,
  p_status text default 'all',
  p_course_id uuid default null
)
returns table (
  member_count bigint,
  active_member_count bigint,
  average_progress numeric,
  attention_total bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with filtered as (
    select * from public.admin_learning_progress_base(p_search, p_status, p_course_id)
  )
  select
    (select count(distinct filtered.member_id) from filtered)::bigint,
    (
      select count(distinct filtered.member_id) from filtered
      where filtered.last_watched_at >= now() - interval '30 days'
    )::bigint,
    (select coalesce(round(avg(filtered.progress_percent), 1), 0) from filtered),
    (
      select count(*)
      from public.admin_learning_progress_base(null, 'attention', null)
    )::bigint;
$$;

-- 강의별 카드. 강의 필터를 빼고 집계해야 카드가 필터에 따라 사라지지 않는다.
create or replace function public.get_admin_learning_course_summary(
  p_search text default null,
  p_status text default 'all'
)
returns table (
  course_id uuid,
  course_title text,
  enrolled bigint,
  in_progress bigint,
  completed bigint,
  recent bigint,
  attention bigint,
  average_progress numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    base.course_id,
    base.course_title,
    count(*)::bigint,
    count(*) filter (where base.learning_state = 'in_progress')::bigint,
    count(*) filter (where base.learning_state = 'completed')::bigint,
    count(*) filter (where base.last_watched_at >= now() - interval '7 days')::bigint,
    count(*) filter (where base.needs_attention)::bigint,
    coalesce(round(avg(base.progress_percent), 1), 0)
  from public.admin_learning_progress_base(p_search, p_status, null) as base
  group by base.course_id, base.course_title
  order by base.course_title;
$$;

-- ---------------------------------------------------------------------------
-- 접근 권한
-- ---------------------------------------------------------------------------

-- 함수 본문이 is_admin()으로 막지만, anon에게 실행 자체를 열어둘 이유가 없다.
revoke all on function public.admin_fulfillment_issue(text, text, text, boolean, text) from anon;
revoke all on function public.admin_order_learning_stats(uuid, uuid, text) from anon;
revoke all on function public.admin_order_ledger_base(text, text, text, timestamptz, boolean) from anon;
revoke all on function public.get_admin_order_ledger_page(text, text, text, timestamptz, boolean, text, integer, integer) from anon;
revoke all on function public.get_admin_order_ledger_summary(text, text, text, timestamptz, boolean) from anon;
revoke all on function public.admin_member_base(text, text) from anon;
revoke all on function public.get_admin_member_entitlements_page(text, text, text, integer, integer) from anon;
revoke all on function public.get_admin_member_summary(text, text) from anon;
revoke all on function public.admin_learning_progress_base(text, text, uuid) from anon;
revoke all on function public.get_admin_learning_progress_page(text, text, uuid, text, integer, integer) from anon;
revoke all on function public.get_admin_learning_summary(text, text, uuid) from anon;
revoke all on function public.get_admin_learning_course_summary(text, text) from anon;

grant execute on function public.get_admin_order_ledger_page(text, text, text, timestamptz, boolean, text, integer, integer) to authenticated;
grant execute on function public.get_admin_order_ledger_summary(text, text, text, timestamptz, boolean) to authenticated;
grant execute on function public.get_admin_member_entitlements_page(text, text, text, integer, integer) to authenticated;
grant execute on function public.get_admin_member_summary(text, text) to authenticated;
grant execute on function public.get_admin_learning_progress_page(text, text, uuid, text, integer, integer) to authenticated;
grant execute on function public.get_admin_learning_summary(text, text, uuid) to authenticated;
grant execute on function public.get_admin_learning_course_summary(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 조회 인덱스
-- ---------------------------------------------------------------------------

-- 목록 정렬과 기간 필터가 매번 타는 경로다.
create index if not exists orders_created_at_desc_idx
  on public.orders (created_at desc);

create index if not exists product_entitlements_user_status_idx
  on public.product_entitlements (user_id, status);

create index if not exists product_entitlements_expires_at_idx
  on public.product_entitlements (expires_at)
  where expires_at is not null;

create index if not exists lesson_progress_user_course_idx
  on public.lesson_progress (user_id, course_slug);
