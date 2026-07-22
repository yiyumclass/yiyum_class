-- Toss 전액 환불을 주문·이용권과 함께 추적한다.
-- 외부 Toss API 호출 자체는 애플리케이션 서버에서 수행하고, 이 마이그레이션의
-- service_role 전용 함수들이 환불 요청 생성과 최종 상태 반영을 담당한다.

-- 1. 환불 판단에 사용할 학습 증거를 사용자가 되돌릴 수 없게 보존한다. ----------

alter table public.lesson_progress
  add column if not exists first_watched_at timestamptz,
  add column if not exists max_position_seconds integer not null default 0,
  add column if not exists first_completed_at timestamptz;

update public.lesson_progress
set
  first_watched_at = coalesce(
    first_watched_at,
    case
      when last_position_seconds > 0 or completed_at is not null then created_at
      else null
    end
  ),
  max_position_seconds = greatest(max_position_seconds, last_position_seconds),
  first_completed_at = coalesce(first_completed_at, completed_at);

alter table public.lesson_progress
  drop constraint if exists lesson_progress_max_position_nonnegative;
alter table public.lesson_progress
  add constraint lesson_progress_max_position_nonnegative
  check (max_position_seconds >= 0);

create or replace function public.preserve_lesson_progress_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.max_position_seconds := greatest(
      coalesce(new.max_position_seconds, 0),
      coalesce(new.last_position_seconds, 0)
    );
    if new.first_watched_at is null
      and (new.last_position_seconds > 0 or new.completed_at is not null) then
      new.first_watched_at := now();
    end if;
    if new.first_completed_at is null and new.completed_at is not null then
      new.first_completed_at := new.completed_at;
    end if;
    return new;
  end if;

  new.max_position_seconds := greatest(
    old.max_position_seconds,
    coalesce(new.max_position_seconds, 0),
    coalesce(new.last_position_seconds, 0)
  );
  new.first_watched_at := coalesce(
    old.first_watched_at,
    new.first_watched_at,
    case
      when new.last_position_seconds > 0 or new.completed_at is not null then now()
      else null
    end
  );
  new.first_completed_at := coalesce(
    old.first_completed_at,
    new.first_completed_at,
    new.completed_at
  );
  return new;
end;
$$;

drop trigger if exists lesson_progress_preserve_evidence on public.lesson_progress;
create trigger lesson_progress_preserve_evidence
  before insert or update on public.lesson_progress
  for each row execute function public.preserve_lesson_progress_evidence();

comment on column public.lesson_progress.first_watched_at is
  '환불 검토용 최초 학습 시작 시각. 한번 기록되면 되돌리지 않는다.';
comment on column public.lesson_progress.max_position_seconds is
  '환불 검토용으로 보존하는 최대 재생 위치. 현재 위치가 되감겨도 감소하지 않는다.';
comment on column public.lesson_progress.first_completed_at is
  '환불 검토용 최초 완료 시각. 사용자가 완료 표시를 해제해도 보존한다.';

-- 2. append-only 성격의 환불 원장 ---------------------------------------------

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  refund_uid text not null unique,
  amount integer not null check (amount > 0),
  reason text not null check (char_length(reason) between 3 and 200),
  status text not null default 'requested'
    check (status in ('requested', 'processing', 'succeeded', 'failed')),
  requested_by uuid references auth.users(id) on delete set null,
  idempotency_key text not null unique,
  toss_transaction_key text unique,
  toss_cancel_status text,
  error_code text,
  error_message text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists payment_refunds_order_idx
  on public.payment_refunds (order_id, requested_at desc);
create unique index if not exists payment_refunds_one_open_per_order_idx
  on public.payment_refunds (order_id)
  where status in ('requested', 'processing');
create unique index if not exists payment_refunds_one_success_per_order_idx
  on public.payment_refunds (order_id)
  where status = 'succeeded';

drop trigger if exists payment_refunds_set_updated_at on public.payment_refunds;
create trigger payment_refunds_set_updated_at
  before update on public.payment_refunds
  for each row execute function public.set_updated_at();

alter table public.payment_refunds enable row level security;
revoke all on table public.payment_refunds from public, anon, authenticated;
grant select, insert, update on table public.payment_refunds to service_role;

comment on table public.payment_refunds is
  'Toss 승인 결제의 환불 요청·성공·실패 이력. 상품 현재가가 아닌 주문 시점 금액을 보존한다.';

-- 3. service_role 전용 환불 상태 전이 ----------------------------------------

create or replace function public.begin_toss_refund_server(
  target_order_id uuid,
  target_actor_user_id uuid,
  target_refund_uid text,
  target_idempotency_key text,
  target_reason text
)
returns table (
  refund_id uuid,
  refund_uid text,
  order_uid text,
  payment_key text,
  amount integer,
  idempotency_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_order public.orders%rowtype;
  existing_refund public.payment_refunds%rowtype;
  created_refund public.payment_refunds%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.admin_users as admin_user
    where admin_user.user_id = target_actor_user_id
      and admin_user.role = 'owner'
      and admin_user.is_active
  ) then
    raise exception 'owner role required' using errcode = '42501';
  end if;
  if target_reason is null or char_length(btrim(target_reason)) not between 3 and 200 then
    raise exception 'refund reason required' using errcode = '22023';
  end if;

  select * into target_order
  from public.orders
  where id = target_order_id
  for update;

  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if target_order.source <> 'payment'
    or target_order.amount <= 0
    or target_order.payment_key is null then
    raise exception 'refundable payment order required' using errcode = '22023';
  end if;
  if target_order.status = 'refunded' then
    raise exception 'order already refunded' using errcode = '23505';
  end if;
  if target_order.status <> 'paid' then
    raise exception 'paid order required' using errcode = '55000';
  end if;

  select * into existing_refund
  from public.payment_refunds
  where order_id = target_order.id
    and status in ('requested', 'processing')
  order by requested_at desc
  limit 1
  for update;

  if found then
    update public.payment_refunds
    set status = 'processing', error_code = null, error_message = null
    where id = existing_refund.id
    returning * into created_refund;
  else
    insert into public.payment_refunds (
      order_id,
      refund_uid,
      amount,
      reason,
      status,
      requested_by,
      idempotency_key
    )
    values (
      target_order.id,
      target_refund_uid,
      target_order.amount,
      btrim(target_reason),
      'processing',
      target_actor_user_id,
      target_idempotency_key
    )
    returning * into created_refund;

    insert into public.admin_audit_logs (
      actor_user_id,
      action,
      target_type,
      target_id,
      metadata
    )
    values (
      target_actor_user_id,
      'payment.refund_requested',
      'order',
      target_order.id::text,
      jsonb_build_object(
        'order_uid', target_order.order_uid,
        'amount', target_order.amount,
        'reason', btrim(target_reason),
        'refund_uid', created_refund.refund_uid
      )
    );
  end if;

  return query
  select
    created_refund.id,
    created_refund.refund_uid,
    target_order.order_uid,
    target_order.payment_key,
    target_order.amount,
    created_refund.idempotency_key;
end;
$$;

create or replace function public.fail_toss_refund_server(
  target_refund_uid text,
  target_error_code text,
  target_error_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_rows integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  update public.payment_refunds
  set
    status = 'failed',
    error_code = left(coalesce(target_error_code, 'UNKNOWN_ERROR'), 120),
    error_message = left(coalesce(target_error_message, '환불 요청이 실패했습니다.'), 500)
  where refund_uid = target_refund_uid
    and status in ('requested', 'processing');

  get diagnostics changed_rows = row_count;
  return changed_rows > 0;
end;
$$;

create or replace function public.complete_toss_refund_server(
  target_order_uid text,
  target_payment_key text,
  target_amount integer,
  target_canceled_at timestamptz,
  target_transaction_key text,
  target_refund_uid text,
  target_actor_user_id uuid,
  target_reason text
)
returns table (
  product_slug text,
  refund_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_order public.orders%rowtype;
  target_product public.products%rowtype;
  existing_refund public.payment_refunds%rowtype;
  resolved_refund_uid text;
  resolved_reason text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select * into target_order
  from public.orders
  where order_uid = target_order_uid
  for update;

  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if target_order.source <> 'payment'
    or target_order.payment_key is distinct from target_payment_key
    or target_order.amount <> target_amount then
    raise exception 'refund verification failed' using errcode = '22023';
  end if;
  if target_order.status not in ('paid', 'refunded') then
    raise exception 'paid order required' using errcode = '55000';
  end if;

  select * into target_product
  from public.products
  where id = target_order.product_id;

  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  if nullif(target_refund_uid, '') is null then
    select * into existing_refund
    from public.payment_refunds
    where order_id = target_order.id
      and status in ('requested', 'processing')
    order by requested_at desc
    limit 1
    for update;
  end if;

  resolved_refund_uid := coalesce(
    nullif(target_refund_uid, ''),
    existing_refund.refund_uid,
    'toss-' || substr(md5(target_payment_key || ':' || target_order_uid), 1, 24)
  );
  resolved_reason := left(
    coalesce(
      nullif(btrim(target_reason), ''),
      existing_refund.reason,
      'Toss 결제 취소 웹훅 동기화'
    ),
    200
  );

  update public.orders
  set
    status = 'refunded',
    canceled_at = coalesce(target_canceled_at, canceled_at, now()),
    updated_at = now()
  where id = target_order.id;

  -- 결제로 발급된 이용권만 회수한다. 결제 후 별도로 관리자 지급으로 전환된
  -- 이용권까지 환불 때문에 제거하지 않는다.
  update public.product_entitlements
  set status = 'revoked', updated_at = now()
  where user_id = target_order.user_id
    and product_id = target_order.product_id
    and source = 'payment';

  insert into public.payment_refunds (
    order_id,
    refund_uid,
    amount,
    reason,
    status,
    requested_by,
    idempotency_key,
    toss_transaction_key,
    toss_cancel_status,
    completed_at
  )
  values (
    target_order.id,
    resolved_refund_uid,
    target_order.amount,
    resolved_reason,
    'succeeded',
    target_actor_user_id,
    'reconcile-' || resolved_refund_uid,
    nullif(target_transaction_key, ''),
    'DONE',
    coalesce(target_canceled_at, now())
  )
  on conflict (refund_uid) do update
  set
    status = 'succeeded',
    toss_transaction_key = coalesce(
      excluded.toss_transaction_key,
      public.payment_refunds.toss_transaction_key
    ),
    toss_cancel_status = 'DONE',
    error_code = null,
    error_message = null,
    completed_at = coalesce(excluded.completed_at, now()),
    updated_at = now();

  if target_order.status <> 'refunded' then
    insert into public.admin_audit_logs (
      actor_user_id,
      action,
      target_type,
      target_id,
      metadata
    )
    values (
      target_actor_user_id,
      'payment.refunded',
      'order',
      target_order.id::text,
      jsonb_build_object(
        'order_uid', target_order.order_uid,
        'product_slug', target_product.slug,
        'amount', target_order.amount,
        'refund_uid', resolved_refund_uid,
        'transaction_key', target_transaction_key
      )
    );
  end if;

  return query select target_product.slug, 'succeeded'::text;
end;
$$;

revoke all on function public.begin_toss_refund_server(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.begin_toss_refund_server(uuid, uuid, text, text, text)
  to service_role;
revoke all on function public.fail_toss_refund_server(text, text, text)
  from public, anon, authenticated;
grant execute on function public.fail_toss_refund_server(text, text, text)
  to service_role;
revoke all on function public.complete_toss_refund_server(text, text, integer, timestamptz, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_toss_refund_server(text, text, integer, timestamptz, text, text, uuid, text)
  to service_role;

-- 4. 관리자 주문 화면: 결제 상태와 실제 이용권 상태를 분리하고 진도를 노출한다. ---

create or replace function public.get_admin_refund_order_ledger()
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
  last_watched_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    orders.id,
    orders.order_uid,
    orders.user_id,
    coalesce(
      nullif(account.raw_user_meta_data ->> 'nickname', ''),
      nullif(account.raw_user_meta_data ->> 'name', ''),
      nullif(split_part(coalesce(account.email, ''), '@', 1), ''),
      '이름 미등록'
    ),
    coalesce(account.email, '이메일 정보 없음'),
    product.id,
    product.slug,
    product.title,
    product.product_type,
    orders.source,
    orders.status,
    case
      when entitlement.status = 'active'
        and (entitlement.expires_at is null or entitlement.expires_at > now())
        then 'active'
      else 'revoked'
    end,
    orders.amount,
    orders.created_at,
    orders.approved_at,
    case when orders.status = 'refunded' then orders.canceled_at else null end,
    entitlement.expires_at,
    orders.payment_key is not null,
    latest_refund.status,
    latest_refund.amount,
    coalesce(learning.total_lessons, 0),
    coalesce(learning.started_lessons, 0),
    coalesce(learning.completed_lessons, 0),
    coalesce(learning.watched_seconds, 0),
    coalesce(learning.progress_percent, 0),
    learning.first_watched_at,
    learning.last_watched_at
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
  left join lateral (
    select
      count(lesson.lesson_key)::bigint as total_lessons,
      count(progress.lesson_id) filter (
        where progress.max_position_seconds > 0
          or progress.first_completed_at is not null
      )::bigint as started_lessons,
      count(progress.lesson_id) filter (
        where progress.first_completed_at is not null
      )::bigint as completed_lessons,
      coalesce(sum(progress.max_position_seconds), 0)::bigint as watched_seconds,
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
      end as progress_percent,
      min(progress.first_watched_at) as first_watched_at,
      max(progress.last_watched_at) as last_watched_at
    from public.course_sections as section
    join public.lessons as lesson
      on lesson.section_id = section.id
     and lesson.status = 'published'
     and lesson.video_path is not null
    left join public.lesson_progress as progress
      on progress.user_id = orders.user_id
     and progress.course_slug = course.slug
     and progress.lesson_id = lesson.lesson_key
    where section.course_id = course.id
      and section.status = 'published'
  ) as learning on course.id is not null
  where public.is_admin()
  order by orders.created_at desc;
$$;

comment on function public.get_admin_refund_order_ledger() is
  '관리자 주문 화면에 결제·이용권 상태, 환불 상태, 되돌릴 수 없는 최대 학습 진도를 분리해 제공한다.';

revoke all on function public.get_admin_refund_order_ledger() from public;
grant execute on function public.get_admin_refund_order_ledger() to authenticated;
