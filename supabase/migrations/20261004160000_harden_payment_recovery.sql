begin;

alter table public.orders
  add column payment_mode text check (payment_mode in ('toss_test', 'toss_live')),
  add column confirmation_state text not null default 'idle'
    check (confirmation_state in ('idle', 'confirming', 'unknown', 'settled', 'review')),
  add column access_period_days_at_purchase integer,
  add column snapshot_captured boolean not null default false;

alter table public.product_entitlements
  add column payment_order_id uuid references public.orders(id);
create unique index product_entitlements_payment_order_idx on public.product_entitlements(payment_order_id)
  where payment_order_id is not null;

create table public.payment_entitlement_grants (
  order_id uuid primary key references public.orders(id),
  user_id uuid not null references auth.users(id),
  product_id uuid not null references public.products(id),
  status text not null check (status in ('active', 'revoked')),
  granted_at timestamptz not null,
  expires_at timestamptz,
  revoked_reason text,
  updated_at timestamptz not null default now()
);
alter table public.payment_entitlement_grants enable row level security;
revoke all on public.payment_entitlement_grants from public, anon, authenticated;
grant select, insert, update on public.payment_entitlement_grants to service_role;

create table public.payment_recovery_jobs (
  order_id uuid primary key references public.orders(id),
  operation text not null check (operation in ('confirmation', 'refund', 'reconcile')),
  status text not null default 'ready' check (status in ('ready', 'processing', 'review', 'done')),
  confirmation_key text,
  idempotency_key text not null unique default gen_random_uuid()::text,
  allow_confirm boolean not null default false,
  lease_token uuid,
  lease_until timestamptz,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.payment_recovery_jobs enable row level security;
revoke all on public.payment_recovery_jobs from public, anon, authenticated;
grant select, insert, update on public.payment_recovery_jobs to service_role;
create index payment_recovery_due_idx on public.payment_recovery_jobs(next_attempt_at)
  where status in ('ready', 'processing');

insert into public.payment_entitlement_grants(order_id, user_id, product_id, status, granted_at, expires_at, revoked_reason)
select payment_order.id, payment_order.user_id, payment_order.product_id,
  entitlement.status, entitlement.granted_at, entitlement.expires_at,
  case when entitlement.status = 'revoked' then 'admin' end
from public.product_entitlements entitlement
join public.orders payment_order on payment_order.user_id = entitlement.user_id
  and payment_order.product_id = entitlement.product_id
  and payment_order.source = 'payment' and payment_order.status = 'paid'
  and payment_order.approved_at = entitlement.granted_at
where entitlement.source = 'payment'
  and (select count(*) from public.orders candidate
    where candidate.user_id = entitlement.user_id and candidate.product_id = entitlement.product_id
      and candidate.source = 'payment' and candidate.status = 'paid') = 1;

update public.product_entitlements entitlement set payment_order_id = payment_grant.order_id
from public.payment_entitlement_grants payment_grant
where entitlement.user_id = payment_grant.user_id and entitlement.product_id = payment_grant.product_id;

insert into public.payment_recovery_jobs(order_id, operation, status, confirmation_key, last_error_code)
select payment_order.id, 'reconcile', 'review', payment_order.payment_key, 'LEGACY_MODE_REQUIRES_VERIFICATION'
from public.orders payment_order
where payment_order.source = 'payment'
  and ((payment_order.status in ('pending', 'failed') and (payment_order.payment_key is not null or payment_order.approved_at is not null))
    or (payment_order.status = 'paid' and not exists (
      select 1 from public.payment_entitlement_grants payment_grant
      where payment_grant.order_id = payment_order.id and payment_grant.status = 'active')));

update public.orders payment_order set confirmation_state = 'review'
where exists (select 1 from public.payment_recovery_jobs job where job.order_id = payment_order.id);

create function public.capture_payment_access_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.source = 'payment' then
    select access_period_days into new.access_period_days_at_purchase
    from public.products where id = new.product_id;
    new.snapshot_captured := true;
  elsif tg_op = 'UPDATE' and (new.snapshot_captured is distinct from old.snapshot_captured
    or new.access_period_days_at_purchase is distinct from old.access_period_days_at_purchase) then
    raise exception 'purchase access snapshot is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger capture_payment_access_snapshot before insert or update on public.orders
  for each row execute function public.capture_payment_access_snapshot();

create function public.guard_uncertain_payment_transition() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.source = 'payment' and old.status = 'pending' and new.status = 'failed'
    and new.confirmation_state <> 'settled'
    and (old.confirmation_state <> 'idle' or old.payment_key is not null or old.approved_at is not null
      or exists (select 1 from public.payment_recovery_jobs job where job.order_id = old.id)) then
    raise exception 'payment recovery pending; cannot fail order' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger guard_uncertain_payment_transition before update of status on public.orders
  for each row execute function public.guard_uncertain_payment_transition();

create function public.guard_withdrawal_payment_recovery() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text || ':sns-membership', 0));
  if exists (select 1 from public.orders payment_order
    where payment_order.user_id = new.user_id and payment_order.source = 'payment'
      and (payment_order.status = 'pending' or (payment_order.status = 'failed'
        and payment_order.confirmation_state <> 'settled'
        and (payment_order.payment_key is not null or payment_order.approved_at is not null
          or exists (select 1 from public.payment_recovery_jobs job
            where job.order_id = payment_order.id and job.status <> 'done'))))) then
    raise exception 'payment_in_progress' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payment_refunds refund
    join public.orders payment_order on payment_order.id = refund.order_id
    where payment_order.user_id = new.user_id and refund.status in ('requested', 'processing')) then
    raise exception 'refund_in_progress' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger guard_withdrawal_payment_recovery before insert or update on public.account_withdrawals
  for each row execute function public.guard_withdrawal_payment_recovery();

create function public.payment_products_share_scope(first_product_id uuid, second_product_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select first_product_id = second_product_id or (
    select count(*) = 2 from public.products
    where id in (first_product_id, second_product_id)
      and slug in ('sns-monetization', 'sns-monetization-feedback', 'sns-monetization-ultra')
  );
$$;

create function public.payment_scope_has_access(target_user_id uuid, target_product_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.product_entitlements entitlement
    where entitlement.user_id = target_user_id
      and public.payment_products_share_scope(entitlement.product_id, target_product_id)
      and entitlement.status = 'active'
      and (entitlement.expires_at is null or entitlement.expires_at > now()));
$$;

create function public.preserve_payment_entitlement_override() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.payment_order_id is not null
    and new.payment_order_id is not distinct from old.payment_order_id
    and (new.source <> 'payment' or new.status is distinct from old.status
      or new.expires_at is distinct from old.expires_at) then
    update public.payment_entitlement_grants
    set status = 'revoked', revoked_reason = 'admin', updated_at = now()
    where order_id = old.payment_order_id and status = 'active';
    if new.status = 'active' then
      new.source := 'admin_grant';
    end if;
  end if;
  if new.source <> 'payment' then new.payment_order_id := null; end if;
  return new;
end;
$$;
create trigger preserve_payment_entitlement_override before insert or update on public.product_entitlements
  for each row execute function public.preserve_payment_entitlement_override();

create function public.bind_toss_order_mode_server(target_user_id uuid, target_order_uid text, target_mode text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if target_mode is null or target_mode not in ('toss_test', 'toss_live') then
    raise exception 'invalid payment mode' using errcode = '22023';
  end if;
  update public.orders set payment_mode = target_mode
  where order_uid = target_order_uid and user_id = target_user_id and source = 'payment'
    and (payment_mode is null or payment_mode = target_mode);
  return found;
end;
$$;

create function public.prepare_toss_confirmation_server(
  target_user_id uuid, target_order_uid text, target_payment_key text, target_amount integer, target_mode text
)
returns table(order_uid text, idempotency_key text, lease_token uuid, can_confirm boolean)
language plpgsql security definer set search_path = '' as $$
declare
  payment_order public.orders%rowtype;
  recovery_job public.payment_recovery_jobs%rowtype;
  permitted boolean;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if target_user_id is null or target_payment_key is null or char_length(target_payment_key) not between 1 and 200
    or target_amount is null or target_amount <= 0
    or target_mode is null or target_mode not in ('toss_test', 'toss_live') then
    raise exception 'invalid confirmation input' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_user_id::text || ':sns-membership', 0));
  select * into payment_order from public.orders where orders.order_uid = target_order_uid for update;
  if not found or payment_order.user_id <> target_user_id or payment_order.source <> 'payment'
    or payment_order.amount <> target_amount or payment_order.payment_mode is distinct from target_mode then
    raise exception 'order verification or payment mode mismatch' using errcode = '22023';
  end if;
  if payment_order.payment_key is not null and payment_order.payment_key <> target_payment_key then
    raise exception 'payment key mismatch' using errcode = '22023';
  end if;
  if payment_order.status in ('refunded', 'canceled') then
    raise exception 'order already canceled' using errcode = '55000';
  end if;
  if exists (select 1 from public.account_withdrawals where user_id = target_user_id) then
    raise exception 'account_withdrawal_in_progress' using errcode = '42501';
  end if;
  select * into recovery_job from public.payment_recovery_jobs where order_id = payment_order.id for update;
  if found then
    if recovery_job.confirmation_key is not null and recovery_job.confirmation_key <> target_payment_key then
      raise exception 'confirmation payment key mismatch' using errcode = '22023';
    end if;
    return query select payment_order.order_uid, recovery_job.idempotency_key, null::uuid, false;
    return;
  end if;
  permitted := payment_order.status = 'pending' and payment_order.confirmation_state = 'idle'
    and payment_order.snapshot_captured and payment_order.payment_key is null and payment_order.approved_at is null
    and payment_order.created_at > now() - interval '30 minutes'
    and payment_order.refund_policy_version is not null
    and payment_order.refund_policy_agreed_at is not null
    and not public.payment_scope_has_access(target_user_id, payment_order.product_id);
  insert into public.payment_recovery_jobs(order_id, operation, confirmation_key, allow_confirm,
    status, lease_token, lease_until, attempt_count)
  values (payment_order.id, case when permitted then 'confirmation' else 'reconcile' end,
    target_payment_key, permitted, 'processing', gen_random_uuid(), now() + interval '120 seconds', 1)
  returning * into recovery_job;
  update public.orders set confirmation_state = case when permitted then 'confirming' else 'unknown' end
  where id = payment_order.id;
  return query select payment_order.order_uid, recovery_job.idempotency_key, recovery_job.lease_token, permitted;
end;
$$;

create function public.claim_toss_payment_recovery(target_mode text, target_limit integer default 5)
returns table(order_uid text, confirmation_key text, idempotency_key text, lease_token uuid, can_confirm boolean, operation text)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if target_mode is null or target_mode not in ('toss_test', 'toss_live')
    or target_limit is null or target_limit not between 1 and 20 then
    raise exception 'invalid recovery claim' using errcode = '22023';
  end if;
  update public.payment_recovery_jobs job set status = 'review', last_error_code = 'RECOVERY_ATTEMPTS_EXHAUSTED',
    lease_token = null, lease_until = null, updated_at = now()
  from public.orders payment_order where payment_order.id = job.order_id and payment_order.payment_mode = target_mode
    and job.status = 'processing' and job.lease_until < now() and job.attempt_count >= 12;
  return query
  with candidates as (
    select job.order_id from public.payment_recovery_jobs job
    join public.orders payment_order on payment_order.id = job.order_id
    where payment_order.payment_mode = target_mode and job.attempt_count < 12
      and ((job.status = 'ready' and job.next_attempt_at <= now())
        or (job.status = 'processing' and job.lease_until < now()))
    order by job.next_attempt_at, job.created_at limit target_limit for update of job skip locked
  ), claimed as (
    update public.payment_recovery_jobs job
    set status = 'processing', lease_token = gen_random_uuid(), lease_until = now() + interval '120 seconds',
      attempt_count = job.attempt_count + 1, updated_at = now()
    from candidates where job.order_id = candidates.order_id returning job.*
  )
  select payment_order.order_uid, claimed.confirmation_key, claimed.idempotency_key, claimed.lease_token,
    claimed.allow_confirm and claimed.operation = 'confirmation'
      and payment_order.status = 'pending' and claimed.created_at > now() - interval '14 days'
      and not public.payment_scope_has_access(payment_order.user_id, payment_order.product_id)
      and not exists (select 1 from public.account_withdrawals where user_id = payment_order.user_id), claimed.operation
  from claimed join public.orders payment_order on payment_order.id = claimed.order_id;
end;
$$;

create function public.finish_toss_payment_recovery(
  target_order_uid text, target_lease_token uuid, target_error_code text, target_review boolean default false
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  marked_review boolean;
  changed_order uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select id into changed_order from public.orders where order_uid = target_order_uid for update;
  if not found then return false; end if;
  update public.payment_recovery_jobs job
  set status = case when coalesce(target_review, false) or job.attempt_count >= 12 then 'review' else 'ready' end,
    last_error_code = left(coalesce(target_error_code, 'UNKNOWN'), 120),
    next_attempt_at = now() + make_interval(secs => least(3600, 30 * (2 ^ least(job.attempt_count, 7))::integer)),
    lease_token = null, lease_until = null, updated_at = now()
  from public.orders payment_order
  where job.order_id = payment_order.id and payment_order.order_uid = target_order_uid
    and job.status = 'processing' and job.lease_token = target_lease_token
    and job.lease_until > now()
  returning job.status = 'review', job.order_id into marked_review, changed_order;
  if not found then return false; end if;
  update public.orders set confirmation_state = case when marked_review then 'review' else 'unknown' end
    where id = changed_order and status not in ('refunded', 'canceled');
  return true;
end;
$$;

create function public.get_toss_payment_recovery_health(target_mode text)
returns table(pending_count bigint, review_count bigint, overdue_count bigint)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if target_mode is null or target_mode not in ('toss_test', 'toss_live') then
    raise exception 'invalid payment mode' using errcode = '22023';
  end if;
  return query select
    count(*) filter (where job.status in ('ready', 'processing')),
    count(*) filter (where job.status = 'review' or (job.status = 'processing' and job.attempt_count >= 12 and job.lease_until < now())),
    count(*) filter (where job.status in ('ready', 'processing') and job.created_at < now() - interval '10 minutes')
  from public.payment_recovery_jobs job join public.orders payment_order on payment_order.id = job.order_id
  where payment_order.payment_mode = target_mode or payment_order.payment_mode is null;
end;
$$;

create function public.settle_toss_unpaid_order_server(
  target_order_uid text, target_payment_key text, target_status text, target_mode text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  payment_order public.orders%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if target_status is null or target_status not in ('ABORTED', 'EXPIRED')
    or nullif(target_payment_key, '') is null or target_mode is null or target_mode not in ('toss_test', 'toss_live') then
    raise exception 'verified unpaid provider status required' using errcode = '22023';
  end if;
  select * into payment_order from public.orders where order_uid = target_order_uid for update;
  if not found or payment_order.source <> 'payment' or payment_order.payment_mode is distinct from target_mode
    or payment_order.status not in ('pending', 'failed') or payment_order.approved_at is not null
    or (payment_order.payment_key is not null and payment_order.payment_key <> target_payment_key) then
    return false;
  end if;
  update public.orders set status = 'failed', confirmation_state = 'settled', payment_key = target_payment_key
    where id = payment_order.id;
  update public.payment_recovery_jobs set status = 'done', allow_confirm = false,
    lease_token = null, lease_until = null, updated_at = now() where order_id = payment_order.id;
  return true;
end;
$$;

create or replace function public.complete_toss_payment_server(
  target_user_id uuid, target_order_uid text, target_payment_key text, target_amount integer, target_approved_at timestamptz
)
returns table(product_slug text, product_type text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  payment_order public.orders%rowtype;
  payment_product public.products%rowtype;
  payment_grant public.payment_entitlement_grants%rowtype;
  current_entitlement public.product_entitlements%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if target_user_id is null or target_payment_key is null or char_length(target_payment_key) not between 1 and 200
    or target_amount is null or target_amount <= 0
    or target_approved_at is null then
    raise exception 'invalid verified payment' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_user_id::text || ':sns-membership', 0));
  select * into payment_order from public.orders where order_uid = target_order_uid for update;
  if not found or payment_order.user_id <> target_user_id or payment_order.source <> 'payment'
    or payment_order.amount <> target_amount or payment_order.payment_mode is null
    or (payment_order.payment_key is not null and payment_order.payment_key <> target_payment_key) then
    raise exception 'order verification failed' using errcode = '22023';
  end if;
  if payment_order.status not in ('pending', 'paid', 'failed') then
    raise exception 'order already canceled' using errcode = '55000';
  end if;
  if exists (select 1 from public.account_withdrawals where user_id = target_user_id) then
    raise exception 'account_withdrawal_in_progress' using errcode = '42501';
  end if;
  select * into payment_product from public.products where id = payment_order.product_id;
  if exists (select 1 from public.product_entitlements entitlement
    where entitlement.user_id = target_user_id and entitlement.product_id <> payment_order.product_id
      and public.payment_products_share_scope(entitlement.product_id, payment_order.product_id)
      and entitlement.status = 'active' and (entitlement.expires_at is null or entitlement.expires_at > now())) then
    raise exception 'another membership owns active access; review required' using errcode = '55000';
  end if;
  select * into payment_grant from public.payment_entitlement_grants where order_id = payment_order.id for update;
  if not found then
    if not payment_order.snapshot_captured then
      raise exception 'legacy access snapshot requires review' using errcode = '55000';
    end if;
    insert into public.payment_entitlement_grants(order_id, user_id, product_id, status, granted_at, expires_at)
    values (payment_order.id, payment_order.user_id, payment_order.product_id, 'active',
      coalesce(payment_order.approved_at, target_approved_at),
      case when payment_order.access_period_days_at_purchase is null then null
        else coalesce(payment_order.approved_at, target_approved_at) + make_interval(days => payment_order.access_period_days_at_purchase) end)
    returning * into payment_grant;
  end if;
  if payment_grant.status <> 'active' or (payment_grant.expires_at is not null and payment_grant.expires_at <= now()) then
    raise exception 'payment grant revoked or expired; review required' using errcode = '55000';
  end if;
  select * into current_entitlement from public.product_entitlements
    where user_id = target_user_id and product_id = payment_order.product_id for update;
  if found and current_entitlement.source <> 'payment' then
    if current_entitlement.status <> 'active'
      or (current_entitlement.expires_at is not null and current_entitlement.expires_at <= now()) then
      raise exception 'manual entitlement override requires review' using errcode = '55000';
    end if;
  elsif found and current_entitlement.payment_order_id is distinct from payment_order.id
    and current_entitlement.status = 'active'
    and (current_entitlement.expires_at is null or current_entitlement.expires_at > now()) then
    raise exception 'another payment owns active entitlement; review required' using errcode = '55000';
  end if;
  update public.orders set status = 'paid', payment_key = target_payment_key,
    approved_at = coalesce(approved_at, target_approved_at), confirmation_state = 'settled', updated_at = now()
  where id = payment_order.id;
  if current_entitlement.id is null or current_entitlement.source = 'payment' then
    insert into public.product_entitlements(user_id, product_id, source, status, granted_at, expires_at, payment_order_id)
    values (target_user_id, payment_order.product_id, 'payment', 'active', payment_grant.granted_at,
      payment_grant.expires_at, payment_order.id)
    on conflict (user_id, product_id) do update set source = excluded.source, status = excluded.status,
      granted_at = excluded.granted_at, expires_at = excluded.expires_at, payment_order_id = excluded.payment_order_id, updated_at = now();
  end if;
  update public.payment_recovery_jobs set status = 'done', allow_confirm = false,
    lease_token = null, lease_until = null, last_error_code = null, updated_at = now()
    where order_id = payment_order.id and operation <> 'refund';
  return query select payment_product.slug, payment_product.product_type, entitlement.expires_at
    from public.product_entitlements entitlement
    where entitlement.user_id = target_user_id and entitlement.product_id = payment_order.product_id
      and entitlement.status = 'active' and (entitlement.expires_at is null or entitlement.expires_at > now());
end;
$$;

create or replace function public.complete_toss_refund_server(
  target_order_uid text, target_payment_key text, target_amount integer, target_canceled_at timestamptz,
  target_transaction_key text, target_refund_uid text, target_actor_user_id uuid, target_reason text
)
returns table(product_slug text, refund_status text)
language plpgsql security definer set search_path = '' as $$
declare
  payment_order public.orders%rowtype;
  refund_record public.payment_refunds%rowtype;
  resolved_uid text;
  resolved_slug text;
  owner_user_id uuid;
  requires_entitlement_review boolean;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select user_id into owner_user_id from public.orders where order_uid = target_order_uid;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_user_id::text || ':sns-membership', 0));
  select * into payment_order from public.orders where order_uid = target_order_uid for update;
  if not found or payment_order.source <> 'payment' or payment_order.amount <> target_amount
    or target_amount is null or target_amount <= 0
    or payment_order.payment_mode is null or nullif(target_payment_key, '') is null
    or (payment_order.payment_key is not null and payment_order.payment_key <> target_payment_key) then
    raise exception 'refund verification failed' using errcode = '22023';
  end if;
  if payment_order.status not in ('paid', 'refunded', 'pending', 'failed') then
    raise exception 'settleable order required' using errcode = '55000';
  end if;
  select slug into resolved_slug from public.products where id = payment_order.product_id;
  select exists (select 1 from public.product_entitlements entitlement
    where entitlement.user_id = payment_order.user_id and entitlement.product_id = payment_order.product_id
      and entitlement.source = 'payment' and entitlement.payment_order_id is null
      and entitlement.status = 'active' and (entitlement.expires_at is null or entitlement.expires_at > now()))
    into requires_entitlement_review;
  if requires_entitlement_review then
    insert into public.payment_recovery_jobs(order_id, operation, status, confirmation_key, last_error_code)
    values (payment_order.id, 'reconcile', 'review', target_payment_key, 'LEGACY_ENTITLEMENT_LINK_REQUIRES_REVIEW')
    on conflict (order_id) do update set status = 'review', allow_confirm = false,
      lease_token = null, lease_until = null, last_error_code = excluded.last_error_code, updated_at = now();
  end if;
  if payment_order.status = 'refunded' then
    update public.payment_recovery_jobs set status = 'done', allow_confirm = false,
      lease_token = null, lease_until = null, updated_at = now()
      where order_id = payment_order.id and not requires_entitlement_review;
    return query select resolved_slug, case when requires_entitlement_review then 'review' else 'succeeded' end;
    return;
  end if;
  select * into refund_record from public.payment_refunds
  where order_id = payment_order.id
    and amount = payment_order.amount
    and (nullif(target_refund_uid, '') is null or refund_uid = target_refund_uid)
  order by (status = 'succeeded') desc, requested_at desc limit 1 for update;
  if target_refund_uid is not null and exists (
    select 1 from public.payment_refunds where refund_uid = target_refund_uid
      and (order_id <> payment_order.id or amount <> payment_order.amount)
  ) then
    raise exception 'refund order mismatch' using errcode = '22023';
  end if;
  resolved_uid := coalesce(refund_record.refund_uid, nullif(target_refund_uid, ''), 'toss-' || substr(md5(target_payment_key || ':' || target_order_uid), 1, 24));
  update public.orders set status = 'refunded', payment_key = target_payment_key,
    canceled_at = coalesce(target_canceled_at, canceled_at, now()),
    confirmation_state = case when requires_entitlement_review then 'review' else 'settled' end, updated_at = now()
    where id = payment_order.id;
  update public.payment_entitlement_grants set status = 'revoked',
    revoked_reason = case when status = 'active' then 'refund' else coalesce(revoked_reason, 'refund') end,
    updated_at = now()
    where order_id = payment_order.id;
  update public.product_entitlements set status = 'revoked', updated_at = now()
    where payment_order_id = payment_order.id and source = 'payment';
  insert into public.payment_refunds(order_id, refund_uid, amount, reason, status, requested_by,
    idempotency_key, toss_transaction_key, toss_cancel_status, completed_at)
  values (payment_order.id, resolved_uid, payment_order.amount,
    left(coalesce(nullif(btrim(target_reason), ''), refund_record.reason, 'Toss 결제 취소 동기화'), 200),
    'succeeded', target_actor_user_id, 'reconcile-' || resolved_uid, nullif(target_transaction_key, ''), 'DONE', coalesce(target_canceled_at, now()))
  on conflict (refund_uid) do update set status = 'succeeded',
    toss_transaction_key = coalesce(excluded.toss_transaction_key, payment_refunds.toss_transaction_key),
    toss_cancel_status = 'DONE', error_code = null, error_message = null, completed_at = excluded.completed_at, updated_at = now();
  update public.payment_recovery_jobs set status = 'done', allow_confirm = false,
    lease_token = null, lease_until = null, last_error_code = null, updated_at = now()
    where order_id = payment_order.id and not requires_entitlement_review;
  insert into public.admin_audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (target_actor_user_id, 'payment.refunded', 'order', payment_order.id::text,
    jsonb_build_object('order_uid', payment_order.order_uid, 'product_slug', resolved_slug,
      'amount', payment_order.amount, 'refund_uid', resolved_uid, 'settled_from_status', payment_order.status));
  return query select resolved_slug, case when requires_entitlement_review then 'review' else 'succeeded' end;
end;
$$;

create or replace function public.create_toss_payment_order(target_product_slug text)
returns table (
  order_uid text,
  amount integer,
  order_name text,
  product_slug text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_product public.products%rowtype;
  existing_order public.orders%rowtype;
  generated_order_uid text;
begin
  if actor_id is null or not public.is_active_account() then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if target_product_slug = 'admin-payment-verification-100'
    and not public.is_admin(array['owner']::text[]) then
    raise exception 'owner role required' using errcode = '42501';
  end if;

  select * into target_product
  from public.products
  where slug = target_product_slug
    and (
      (slug <> 'admin-payment-verification-100' and status = 'active')
      or (
        slug = 'admin-payment-verification-100'
        and status = 'draft'
        and price_krw = 100
        and product_type = 'course'
      )
    );

  if not found then
    raise exception 'active product not found' using errcode = 'P0002';
  end if;

  if target_product.price_krw <= 0 then
    raise exception 'paid product required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':sns-membership', 0)
  );

  update public.orders
  set status = 'failed', updated_at = now()
  where user_id = actor_id
    and product_id = target_product.id
    and source = 'payment'
    and status = 'pending'
    and created_at < now() - interval '30 minutes'
    and payment_key is null and approved_at is null and confirmation_state = 'idle'
    and not exists (select 1 from public.payment_recovery_jobs job where job.order_id = orders.id);

  if exists (
    select 1 from public.orders unresolved
    where unresolved.user_id = actor_id and unresolved.source = 'payment'
      and public.payment_products_share_scope(unresolved.product_id, target_product.id)
      and unresolved.status in ('pending', 'failed') and unresolved.confirmation_state <> 'settled'
      and (unresolved.payment_key is not null or unresolved.approved_at is not null
        or unresolved.confirmation_state <> 'idle'
        or exists (select 1 from public.payment_recovery_jobs job
          where job.order_id = unresolved.id and job.status <> 'done'))
  ) then
    raise exception 'payment recovery pending; do not pay again' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.product_entitlements as entitlement
    where entitlement.user_id = actor_id
      and entitlement.product_id = target_product.id
      and entitlement.status = 'active'
      and (entitlement.expires_at is null or entitlement.expires_at > now())
  ) then
    raise exception 'active entitlement already exists' using errcode = '23505';
  end if;

  select * into existing_order
  from public.orders
  where user_id = actor_id
    and product_id = target_product.id
    and source = 'payment'
    and status = 'pending'
  order by created_at desc
  limit 1
  for update;

  if found then
    return query
    select
      existing_order.order_uid,
      existing_order.amount,
      target_product.title,
      target_product.slug;
    return;
  end if;

  generated_order_uid := public.generate_order_uid();

  insert into public.orders (
    user_id, product_id, order_uid, amount, source, status
  )
  values (
    actor_id, target_product.id, generated_order_uid,
    target_product.price_krw, 'payment', 'pending'
  );

  return query
  select
    generated_order_uid,
    target_product.price_krw,
    target_product.title,
    target_product.slug;
end;
$$;

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
  if (select auth.role()) is distinct from 'service_role' then
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
    or target_order.payment_key is null or target_order.payment_mode is null then
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
    and status in ('requested', 'processing', 'failed')
    and payment_refunds.amount = target_order.amount
  order by requested_at desc
  limit 1
  for update;

  if found then
    if existing_refund.requested_at < now() - interval '14 days' then
      raise exception 'refund idempotency window expired; review required' using errcode = '55000';
    end if;
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

  insert into public.payment_recovery_jobs(order_id, operation, status, confirmation_key, next_attempt_at)
  values (target_order.id, 'refund', 'ready', target_order.payment_key, now() + interval '120 seconds')
  on conflict (order_id) do update set operation = 'refund', status = 'ready',
    allow_confirm = false, lease_token = null, lease_until = null, attempt_count = 0,
    next_attempt_at = now() + interval '120 seconds', last_error_code = null, updated_at = now();

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

create function public.ensure_toss_reconciliation_server(
  target_user_id uuid, target_order_uid text, target_payment_key text, target_amount integer,
  target_mode text, target_provider_status text, target_approved_at timestamptz
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  payment_order public.orders%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if target_provider_status is null or target_provider_status not in ('DONE', 'CANCELED', 'PARTIAL_CANCELED')
    or target_amount is null or target_amount <= 0
    or target_mode is null or target_mode not in ('toss_test', 'toss_live')
    or target_payment_key is null or char_length(target_payment_key) not between 1 and 200
    or (target_provider_status = 'DONE' and target_approved_at is null) then
    raise exception 'verified provider payment required' using errcode = '22023';
  end if;
  select * into payment_order from public.orders where order_uid = target_order_uid for update;
  if not found or payment_order.user_id is distinct from target_user_id or payment_order.source <> 'payment'
    or payment_order.amount <> target_amount or payment_order.payment_mode is distinct from target_mode
    or (payment_order.payment_key is not null and payment_order.payment_key <> target_payment_key) then
    raise exception 'verified order mismatch' using errcode = '22023';
  end if;
  update public.orders set payment_key = target_payment_key,
    approved_at = coalesce(approved_at, target_approved_at),
    confirmation_state = case
      when target_provider_status = 'PARTIAL_CANCELED' and status not in ('refunded', 'canceled') then 'review'
      when status in ('pending', 'failed') then 'unknown' else confirmation_state end
    where id = payment_order.id;
  insert into public.payment_recovery_jobs(order_id, operation, status, confirmation_key, last_error_code)
  values (payment_order.id, 'reconcile',
    case when payment_order.status in ('refunded', 'canceled') then 'done'
      when target_provider_status = 'PARTIAL_CANCELED' then 'review' else 'ready' end,
    target_payment_key, case when target_provider_status = 'PARTIAL_CANCELED' then 'PARTIAL_CANCELLATION_UNSUPPORTED' end)
  on conflict (order_id) do update set confirmation_key = excluded.confirmation_key,
    allow_confirm = false,
    status = case when excluded.status = 'done' then payment_recovery_jobs.status
      when excluded.status = 'review' then 'review'
      when payment_recovery_jobs.status in ('processing', 'review') then payment_recovery_jobs.status else 'ready' end,
    last_error_code = coalesce(excluded.last_error_code, payment_recovery_jobs.last_error_code),
    next_attempt_at = now(), updated_at = now();
  return true;
end;
$$;

create or replace function public.fail_toss_payment_order(target_order_uid text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  update public.orders set status = 'failed', updated_at = now()
  where order_uid = target_order_uid and user_id = (select auth.uid()) and source = 'payment'
    and status = 'pending' and payment_key is null and approved_at is null and confirmation_state = 'idle'
    and not exists (select 1 from public.payment_recovery_jobs job where job.order_id = orders.id);
  return found;
end;
$$;

create or replace function public.expire_stale_toss_payment_orders(target_older_than_minutes integer default 60)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  changed_rows integer;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if target_older_than_minutes is null or target_older_than_minutes < 30 then
    raise exception 'cutoff must be at least 30 minutes' using errcode = '22023';
  end if;
  update public.orders set status = 'failed', updated_at = now()
  where source = 'payment' and status = 'pending' and payment_key is null and approved_at is null
    and confirmation_state = 'idle' and created_at < now() - make_interval(mins => target_older_than_minutes)
    and not exists (select 1 from public.payment_recovery_jobs job where job.order_id = orders.id);
  get diagnostics changed_rows = row_count;
  return changed_rows;
end;
$$;

create or replace function public.fail_pending_membership_orders_after_entitlement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and (new.expires_at is null or new.expires_at > now())
    and exists (select 1 from public.products where id = new.product_id
      and slug in ('sns-monetization', 'sns-monetization-feedback', 'sns-monetization-ultra')) then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text || ':sns-membership', 0));
    update public.orders pending_order set status = 'failed', updated_at = now()
    where pending_order.user_id = new.user_id and pending_order.source = 'payment' and pending_order.status = 'pending'
      and pending_order.payment_key is null and pending_order.approved_at is null
      and pending_order.confirmation_state = 'idle'
      and not exists (select 1 from public.payment_recovery_jobs job where job.order_id = pending_order.id)
      and public.payment_products_share_scope(pending_order.product_id, new.product_id);
  end if;
  return new;
end;
$$;

do $$
declare
  routine record;
begin
  for routine in select procedure.oid::regprocedure as signature, procedure.proname
    from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public' and procedure.proname = any(array[
      'capture_payment_access_snapshot', 'guard_uncertain_payment_transition', 'guard_withdrawal_payment_recovery',
      'payment_products_share_scope', 'payment_scope_has_access',
      'preserve_payment_entitlement_override', 'bind_toss_order_mode_server', 'prepare_toss_confirmation_server',
      'claim_toss_payment_recovery', 'finish_toss_payment_recovery', 'get_toss_payment_recovery_health',
      'settle_toss_unpaid_order_server', 'ensure_toss_reconciliation_server', 'complete_toss_payment_server',
      'complete_toss_refund_server', 'begin_toss_refund_server', 'expire_stale_toss_payment_orders',
      'fail_pending_membership_orders_after_entitlement'
    ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', routine.signature);
    if routine.proname not in ('capture_payment_access_snapshot', 'guard_uncertain_payment_transition',
      'guard_withdrawal_payment_recovery', 'payment_products_share_scope',
      'payment_scope_has_access', 'preserve_payment_entitlement_override', 'fail_pending_membership_orders_after_entitlement') then
      execute format('grant execute on function %s to service_role', routine.signature);
    end if;
  end loop;
end;
$$;

revoke all on function public.create_toss_payment_order(text) from public, anon;
grant execute on function public.create_toss_payment_order(text) to authenticated;
revoke all on function public.fail_toss_payment_order(text) from public, anon;
grant execute on function public.fail_toss_payment_order(text) to authenticated;

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
    left join lateral (
      select current_access.id, current_access.status, current_access.expires_at
      from public.product_entitlements current_access
      where orders.source <> 'payment' and current_access.user_id = orders.user_id
        and current_access.product_id = orders.product_id
      union all
      select payment_grant.order_id,
        case when payment_grant.status = 'active' and current_access.status = 'active'
          and current_access.payment_order_id = payment_grant.order_id then 'active' else 'revoked' end,
        payment_grant.expires_at
      from public.payment_entitlement_grants payment_grant
      left join public.product_entitlements current_access on current_access.user_id = payment_grant.user_id
        and current_access.product_id = payment_grant.product_id
      where orders.source = 'payment' and payment_grant.order_id = orders.id
    ) as entitlement on true
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

create or replace function public.get_my_order_ledger()
returns table (
  transaction_id uuid,
  order_uid text,
  product_slug text,
  product_title text,
  product_type text,
  amount_krw integer,
  source text,
  payment_status text,
  entitlement_status text,
  ordered_at timestamptz,
  approved_at timestamptz,
  refunded_at timestamptz,
  expires_at timestamptz,
  refund_status text,
  refund_amount_krw integer,
  refund_policy_agreed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    orders.id,
    orders.order_uid,
    product.slug,
    product.title,
    product.product_type,
    orders.amount,
    orders.source,
    orders.status,
    case
      when entitlement.id is null then 'none'
      when entitlement.status = 'revoked' then 'revoked'
      when entitlement.expires_at is not null
        and entitlement.expires_at <= now() then 'expired'
      else 'active'
    end,
    orders.created_at,
    orders.approved_at,
    case when orders.status = 'refunded' then orders.canceled_at else null end,
    entitlement.expires_at,
    case
      when latest_refund.error_code = 'PARTIAL_CANCELLATION_UNSUPPORTED'
        then 'partial_review'
      else latest_refund.status
    end,
    latest_refund.amount,
    orders.refund_policy_agreed_at
  from public.orders as orders
  join public.products as product on product.id = orders.product_id
  left join lateral (
      select current_access.id, current_access.status, current_access.expires_at
      from public.product_entitlements current_access
      where orders.source <> 'payment' and current_access.user_id = orders.user_id
        and current_access.product_id = orders.product_id
      union all
      select payment_grant.order_id,
        case when payment_grant.status = 'active' and current_access.status = 'active'
          and current_access.payment_order_id = payment_grant.order_id then 'active' else 'revoked' end,
        payment_grant.expires_at
      from public.payment_entitlement_grants payment_grant
      left join public.product_entitlements current_access on current_access.user_id = payment_grant.user_id
        and current_access.product_id = payment_grant.product_id
      where orders.source = 'payment' and payment_grant.order_id = orders.id
    ) as entitlement on true
  left join lateral (
    select refund.status, refund.amount, refund.error_code
    from public.payment_refunds as refund
    where refund.order_id = orders.id
    order by refund.requested_at desc
    limit 1
  ) as latest_refund on true
  where orders.user_id = (select auth.uid())
    and public.is_active_account()
  order by orders.created_at desc;
$$;

create or replace function public.claim_payment_notification(target_order_uid text default null)
returns table(order_id uuid, order_uid text, user_id uuid, product_slug text,
  amount integer, approved_at timestamptz, attempt_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  claimed public.payment_notifications%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.payment_notifications n set status = 'preparing', attempts = n.attempts + 1,
    attempt_id = gen_random_uuid(), updated_at = now()
  where n.order_id = (
    select q.order_id from public.payment_notifications q
    join public.orders o on o.id = q.order_id
    where (target_order_uid is null or o.order_uid = target_order_uid)
      and q.attempts < 3
      and ((q.status in ('pending', 'failed') and q.next_attempt_at <= now())
        or (q.status = 'preparing' and q.updated_at < now() - interval '10 minutes'))
      and o.status = 'paid' and o.source = 'payment' and o.approved_at is not null
      and exists (select 1 from public.product_entitlements e
        where e.payment_order_id = o.id and e.user_id = o.user_id and e.product_id = o.product_id and e.status = 'active'
          and (e.expires_at is null or e.expires_at > now()))
    order by q.next_attempt_at, q.created_at
    limit 1 for update of q skip locked
  ) returning n.* into claimed;
  if not found then return; end if;
  return query select o.id, o.order_uid, o.user_id, p.slug, o.amount, o.approved_at, claimed.attempt_id
    from public.orders o join public.products p on p.id = o.product_id where o.id = claimed.order_id;
end;
$$;

create or replace function public.begin_payment_notification_send(target_order_id uuid, target_attempt_id uuid, target_template_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.payment_notifications n set status = 'sending', template_id = target_template_id, updated_at = now()
  where n.order_id = target_order_id and n.attempt_id = target_attempt_id and n.status = 'preparing'
    and exists (select 1 from public.orders o join public.product_entitlements e
      on e.payment_order_id = o.id and e.user_id = o.user_id and e.product_id = o.product_id
      where o.id = n.order_id and o.status = 'paid' and o.source = 'payment'
        and e.status = 'active' and (e.expires_at is null or e.expires_at > now()));
  return found;
end;
$$;

revoke all on function public.admin_order_ledger_base(text, text, text, timestamptz, boolean) from public, anon;
grant execute on function public.admin_order_ledger_base(text, text, text, timestamptz, boolean) to authenticated;
revoke all on function public.get_my_order_ledger() from public, anon;
grant execute on function public.get_my_order_ledger() to authenticated;
revoke all on function public.claim_payment_notification(text) from public, anon, authenticated;
grant execute on function public.claim_payment_notification(text) to service_role;
revoke all on function public.begin_payment_notification_send(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.begin_payment_notification_send(uuid, uuid, text) to service_role;

commit;
