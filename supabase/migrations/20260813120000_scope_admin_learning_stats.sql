-- Keep administrator order and learning statistics on the same chapter scope
-- that member catalog, playback, and progress writes enforce.

create or replace function public.admin_product_available_lessons(p_product_id uuid)
returns table (
  course_id uuid,
  course_slug text,
  lesson_key text,
  lesson_title text,
  duration_seconds integer
)
language sql
stable
parallel safe
set search_path = ''
as $$
  select
    course.id,
    course.slug,
    lesson.lesson_key,
    lesson.title,
    lesson.duration_seconds
  from public.product_course_scopes scope
  join public.courses course on course.id = scope.course_id
  join public.course_sections section
    on section.course_id = course.id
   and section.status = 'published'
   and (
     scope.access_mode = 'full'
     or exists (
       select 1 from public.product_course_scope_sections chosen
       where chosen.product_id = scope.product_id
         and chosen.section_id = section.id
     )
   )
  join public.lessons lesson
    on lesson.section_id = section.id
   and lesson.status = 'published'
   and (
     lesson.video_path is not null
     or (lesson.mux_playback_id is not null and lesson.mux_status = 'ready')
   )
  where scope.product_id = p_product_id
    and course.status = 'published';
$$;

create or replace function public.admin_order_learning_stats(
  p_user_id uuid,
  p_product_id uuid
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
      else round((coalesce(sum(
        case
          when progress.first_completed_at is not null then 1::numeric
          when progress.lesson_id is null then 0::numeric
          else least(0.99::numeric, greatest(
            0::numeric,
            progress.max_position_seconds::numeric /
              nullif(coalesce(nullif(progress.duration_seconds, 0), lesson.duration_seconds), 0)
          ))
        end
      ), 0) / count(lesson.lesson_key)::numeric) * 100, 1)
    end,
    min(progress.first_watched_at),
    max(progress.last_watched_at)
  from public.admin_product_available_lessons(p_product_id) lesson
  left join public.lesson_progress progress
    on progress.user_id = p_user_id
   and progress.course_slug = lesson.course_slug
   and progress.lesson_id = lesson.lesson_key;
$$;

create or replace function public.admin_order_ledger_base(
  p_search text default null,
  p_source text default 'all',
  p_status text default 'all',
  p_since timestamptz default null,
  p_attention boolean default false
)
returns table (
  transaction_id uuid, order_uid text, customer_id uuid, customer_name text,
  customer_email text, product_id uuid, product_slug text, product_title text,
  product_type text, course_id uuid, course_slug text, source text,
  payment_status text, entitlement_status text, amount_krw integer,
  created_at timestamptz, approved_at timestamptz, refunded_at timestamptz,
  expires_at timestamptz, payment_key_present boolean, refund_status text,
  refund_amount integer, fulfillment_issue text
)
language sql stable security definer set search_path = ''
as $$
  with resolved as (
    select
      orders.id as transaction_id, orders.order_uid, orders.user_id as customer_id,
      coalesce(
        nullif(account.raw_user_meta_data ->> 'nickname', ''),
        nullif(account.raw_user_meta_data ->> 'name', ''),
        nullif(split_part(coalesce(account.email, ''), '@', 1), ''),
        '이름 미등록'
      ) as customer_name,
      coalesce(account.email, '이메일 정보 없음') as customer_email,
      product.id as product_id, product.slug as product_slug,
      product.title as product_title, product.product_type,
      course.id as course_id, course.slug as course_slug,
      orders.source, orders.status as payment_status,
      case when entitlement.status = 'active'
        and (entitlement.expires_at is null or entitlement.expires_at > now())
        then 'active' else 'revoked' end as entitlement_status,
      orders.amount as amount_krw, orders.created_at, orders.approved_at,
      case when orders.status = 'refunded' then orders.canceled_at else null end as refunded_at,
      entitlement.expires_at, orders.payment_key is not null as payment_key_present,
      latest_refund.status as refund_status, latest_refund.amount as refund_amount
    from public.orders orders
    join public.products product on product.id = orders.product_id
    join auth.users account on account.id = orders.user_id
    left join public.product_entitlements entitlement
      on entitlement.user_id = orders.user_id and entitlement.product_id = orders.product_id
    left join public.product_course_scopes scope on scope.product_id = product.id
    left join public.courses course on course.id = scope.course_id
    left join lateral (
      select refund.status, refund.amount
      from public.payment_refunds refund
      where refund.order_id = orders.id
      order by refund.requested_at desc limit 1
    ) latest_refund on true
    where public.is_admin()
  )
  select resolved.*,
    public.admin_fulfillment_issue(
      resolved.source, resolved.payment_status, resolved.entitlement_status,
      resolved.payment_key_present, resolved.refund_status
    )
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
      resolved.source, resolved.payment_status, resolved.entitlement_status,
      resolved.payment_key_present, resolved.refund_status
    ) is not null
  );
$$;

create or replace function public.get_admin_order_ledger_page(
  p_search text default null, p_source text default 'all',
  p_status text default 'all', p_since timestamptz default null,
  p_attention boolean default false, p_sort text default 'created_desc',
  p_limit integer default 25, p_offset integer default 0
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
    select * from public.admin_order_ledger_base(
      p_search, p_source, p_status, p_since, p_attention
    )
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

create or replace function public.admin_learning_progress_base(
  p_search text default null,
  p_status text default 'all',
  p_course_id uuid default null
)
returns table (
  member_id uuid, member_email text, member_name text, entitlement_id uuid,
  course_id uuid, course_slug text, course_title text, total_lessons bigint,
  started_lessons bigint, completed_lessons bigint, watched_seconds bigint,
  progress_percent numeric, last_watched_at timestamptz, last_lesson_key text,
  last_lesson_title text, learning_state text, needs_attention boolean
)
language sql stable security definer set search_path = ''
as $$
  with eligible_enrollments as (
    select
      entitlement.id as entitlement_id, entitlement.product_id,
      account.id as member_id,
      coalesce(account.email, '이메일 정보 없음') as member_email,
      coalesce(
        nullif(account.raw_user_meta_data ->> 'nickname', ''),
        nullif(account.raw_user_meta_data ->> 'name', ''),
        nullif(split_part(coalesce(account.email, ''), '@', 1), ''),
        '이름 미등록'
      ) as member_name,
      course.id as course_id, course.slug as course_slug, course.title as course_title
    from public.product_entitlements entitlement
    join auth.users account on account.id = entitlement.user_id
    join public.product_course_scopes scope on scope.product_id = entitlement.product_id
    join public.courses course on course.id = scope.course_id
    where public.is_admin() and account.deleted_at is null
      and entitlement.status = 'active'
      and (entitlement.expires_at is null or entitlement.expires_at > now())
      and course.status = 'published'
      and (p_course_id is null or course.id = p_course_id)
  ), aggregated_progress as (
    select
      enrollment.entitlement_id, enrollment.member_id, enrollment.member_email,
      enrollment.member_name, enrollment.course_id, enrollment.course_slug,
      enrollment.course_title, count(lesson.lesson_key)::bigint as total_lessons,
      count(progress.lesson_id) filter (
        where progress.last_position_seconds > 0 or progress.completed_at is not null
      )::bigint as started_lessons,
      count(progress.lesson_id) filter (where progress.completed_at is not null)::bigint
        as completed_lessons,
      coalesce(sum(progress.last_position_seconds), 0)::bigint as watched_seconds,
      case when count(lesson.lesson_key) = 0 then 0::numeric else round((sum(
        case
          when progress.completed_at is not null then 1::numeric
          when progress.lesson_id is null then 0::numeric
          else least(0.99::numeric, greatest(
            0::numeric,
            progress.last_position_seconds::numeric /
              nullif(coalesce(nullif(progress.duration_seconds, 0), lesson.duration_seconds), 0)
          ))
        end
      ) / count(lesson.lesson_key)::numeric) * 100, 1) end as progress_percent,
      max(progress.last_watched_at) as last_watched_at
    from eligible_enrollments enrollment
    left join lateral public.admin_product_available_lessons(enrollment.product_id) lesson on true
    left join public.lesson_progress progress
      on progress.user_id = enrollment.member_id
     and progress.course_slug = lesson.course_slug
     and progress.lesson_id = lesson.lesson_key
    group by enrollment.entitlement_id, enrollment.member_id, enrollment.member_email,
      enrollment.member_name, enrollment.course_id, enrollment.course_slug,
      enrollment.course_title
  ), latest_lessons as (
    select distinct on (enrollment.entitlement_id)
      enrollment.entitlement_id, progress.lesson_id as last_lesson_key,
      lesson.lesson_title as last_lesson_title
    from eligible_enrollments enrollment
    join lateral public.admin_product_available_lessons(enrollment.product_id) lesson on true
    join public.lesson_progress progress
      on progress.user_id = enrollment.member_id
     and progress.course_slug = lesson.course_slug
     and progress.lesson_id = lesson.lesson_key
    order by enrollment.entitlement_id, progress.last_watched_at desc
  ), labeled as (
    select aggregate.member_id, aggregate.member_email, aggregate.member_name,
      aggregate.entitlement_id, aggregate.course_id, aggregate.course_slug,
      aggregate.course_title, aggregate.total_lessons, aggregate.started_lessons,
      aggregate.completed_lessons, aggregate.watched_seconds,
      coalesce(aggregate.progress_percent, 0) as progress_percent,
      aggregate.last_watched_at, latest.last_lesson_key, latest.last_lesson_title,
      case
        when aggregate.total_lessons > 0
          and aggregate.completed_lessons >= aggregate.total_lessons then 'completed'
        when aggregate.last_watched_at is null
          and aggregate.started_lessons = 0 then 'not_started'
        else 'in_progress'
      end as learning_state
    from aggregated_progress aggregate
    left join latest_lessons latest on latest.entitlement_id = aggregate.entitlement_id
  ), scored as (
    select labeled.*,
      case when labeled.learning_state = 'completed' then false
        when labeled.last_watched_at is null then true
        else labeled.last_watched_at < now() - interval '14 days' end as needs_attention
    from labeled
  )
  select * from scored
  where (
    p_search is null or btrim(p_search) = ''
    or scored.member_name ilike '%' || btrim(p_search) || '%'
    or scored.member_email ilike '%' || btrim(p_search) || '%'
    or scored.course_title ilike '%' || btrim(p_search) || '%'
  ) and (
    p_status is null or p_status = 'all'
    or (p_status = 'attention' and scored.needs_attention)
    or (p_status <> 'attention' and scored.learning_state = p_status)
  );
$$;

revoke all on function public.admin_product_available_lessons(uuid) from anon;
revoke all on function public.admin_order_learning_stats(uuid, uuid) from anon;
revoke all on function public.admin_order_ledger_base(text, text, text, timestamptz, boolean) from anon;
revoke all on function public.get_admin_order_ledger_page(text, text, text, timestamptz, boolean, text, integer, integer) from anon;
revoke all on function public.admin_learning_progress_base(text, text, uuid) from anon;
