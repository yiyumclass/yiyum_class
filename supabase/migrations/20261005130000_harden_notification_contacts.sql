begin;

create table public.user_notification_contacts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kakao_user_id text not null check (kakao_user_id ~ '^[1-9][0-9]*$'),
  phone text not null check (phone ~ '^010[0-9]{8}$'),
  verified_at timestamptz not null default now()
);
alter table public.user_notification_contacts enable row level security;
revoke all on public.user_notification_contacts from public, anon, authenticated;
grant select, insert, update, delete on public.user_notification_contacts to service_role;

alter table public.payment_notifications drop constraint payment_notifications_status_check;
alter table public.payment_notifications add constraint payment_notifications_status_check
  check (status in ('pending', 'preparing', 'sending', 'accepted', 'failed', 'unknown', 'skipped', 'waiting_contact', 'delivered', 'delivery_failed', 'review'));
alter table public.payment_notifications
  add column send_started_at timestamptz,
  add column provider_status_code text,
  add column delivery_checked_at timestamptz,
  add column delivery_check_after timestamptz not null default now(),
  add column delivered_at timestamptz;
update public.payment_notifications set send_started_at = updated_at
  where status in ('sending', 'unknown', 'accepted');
create index payment_notifications_delivery_idx on public.payment_notifications(delivery_check_after)
  where status in ('sending', 'unknown', 'accepted');

create function public.guard_notification_contact()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 0));
  perform 1 from auth.users where id = new.user_id and deleted_at is null for share;
  if not found
    or exists (select 1 from public.account_withdrawals where user_id = new.user_id) then
    raise exception 'account_inactive' using errcode = '42501';
  end if;
  new.verified_at := now();
  return new;
end;
$$;
revoke all on function public.guard_notification_contact() from public, anon, authenticated;
create trigger guard_notification_contact before insert or update on public.user_notification_contacts
  for each row execute function public.guard_notification_contact();

create function public.purge_withdrawn_notification_contact()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.user_notification_contacts where user_id = new.user_id;
  return new;
end;
$$;
revoke all on function public.purge_withdrawn_notification_contact() from public, anon, authenticated;
create trigger purge_withdrawn_notification_contact after insert on public.account_withdrawals
  for each row execute function public.purge_withdrawn_notification_contact();

create function public.purge_deleted_notification_contact()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null then
    delete from public.user_notification_contacts where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.purge_deleted_notification_contact() from public, anon, authenticated;
create trigger purge_deleted_notification_contact after update of deleted_at on auth.users
  for each row execute function public.purge_deleted_notification_contact();

create function public.resume_contact_payment_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.payment_notifications notification
  set status = 'pending', attempts = 0, attempt_id = null, error_code = null,
    next_attempt_at = now(), updated_at = now()
  from public.orders payment_order
  where notification.order_id = payment_order.id and payment_order.user_id = new.user_id
    and payment_order.status = 'paid' and payment_order.source = 'payment'
    and notification.status = 'waiting_contact' and notification.send_started_at is null
    and notification.provider_message_id is null and notification.provider_group_id is null
    and notification.created_at > now() - interval '7 days';
  return new;
end;
$$;
revoke all on function public.resume_contact_payment_notifications() from public, anon, authenticated;
create trigger resume_contact_payment_notifications after insert or update on public.user_notification_contacts
  for each row execute function public.resume_contact_payment_notifications();

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
  update public.payment_notifications notification
  set status = 'preparing', attempts = notification.attempts + 1,
    attempt_id = gen_random_uuid(), updated_at = now()
  where notification.order_id = (
    select queued.order_id from public.payment_notifications queued
    join public.orders payment_order on payment_order.id = queued.order_id
    join auth.users account on account.id = payment_order.user_id and account.deleted_at is null
    where (target_order_uid is null or payment_order.order_uid = target_order_uid)
      and queued.attempts < 3
      and queued.provider_message_id is null and queued.provider_group_id is null
      and ((queued.status in ('pending', 'failed') and queued.next_attempt_at <= now())
        or (queued.status = 'preparing' and queued.updated_at < now() - interval '10 minutes'))
      and payment_order.status = 'paid' and payment_order.source = 'payment' and payment_order.approved_at is not null
      and not exists (select 1 from public.account_withdrawals withdrawal where withdrawal.user_id = payment_order.user_id)
      and not exists (select 1 from public.payment_refunds refund where refund.order_id = payment_order.id and refund.status in ('requested', 'processing', 'succeeded'))
      and exists (select 1 from public.product_entitlements entitlement
        where entitlement.payment_order_id = payment_order.id and entitlement.user_id = payment_order.user_id
          and entitlement.product_id = payment_order.product_id and entitlement.status = 'active'
          and (entitlement.expires_at is null or entitlement.expires_at > now()))
    order by queued.next_attempt_at, queued.created_at
    limit 1 for update of queued skip locked
  ) returning notification.* into claimed;
  if not found then return; end if;
  return query select payment_order.id, payment_order.order_uid, payment_order.user_id, product.slug,
    payment_order.amount, payment_order.approved_at, claimed.attempt_id
    from public.orders payment_order join public.products product on product.id = payment_order.product_id
    where payment_order.id = claimed.order_id;
end;
$$;

create or replace function public.begin_payment_notification_send(target_order_id uuid, target_attempt_id uuid, target_template_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.payment_notifications notification
  set status = 'sending', template_id = target_template_id, send_started_at = now(),
    delivery_check_after = now() + interval '1 minute', updated_at = now()
  where notification.order_id = target_order_id and notification.attempt_id = target_attempt_id
    and notification.status = 'preparing' and notification.provider_message_id is null
    and notification.provider_group_id is null
    and exists (
      select 1 from public.orders payment_order
      join auth.users account on account.id = payment_order.user_id and account.deleted_at is null
      join public.product_entitlements entitlement
        on entitlement.payment_order_id = payment_order.id and entitlement.user_id = payment_order.user_id
          and entitlement.product_id = payment_order.product_id
      where payment_order.id = notification.order_id and payment_order.status = 'paid'
        and payment_order.source = 'payment' and entitlement.status = 'active'
        and (entitlement.expires_at is null or entitlement.expires_at > now())
        and not exists (select 1 from public.account_withdrawals withdrawal where withdrawal.user_id = payment_order.user_id)
        and not exists (select 1 from public.payment_refunds refund where refund.order_id = payment_order.id and refund.status in ('requested', 'processing', 'succeeded'))
    );
  return found;
end;
$$;
revoke all on function public.claim_payment_notification(text) from public, anon, authenticated;
grant execute on function public.claim_payment_notification(text) to service_role;
revoke all on function public.begin_payment_notification_send(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.begin_payment_notification_send(uuid, uuid, text) to service_role;

create function public.get_payment_notification_health()
returns table(pending_count bigint, attention_count bigint, delivered_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return query select
    count(*) filter (where notification.status in ('pending', 'preparing', 'sending', 'accepted', 'failed')),
    count(*) filter (where notification.status in ('waiting_contact', 'unknown', 'delivery_failed', 'review')
      or notification.status = 'failed' and notification.attempts >= 3
      or notification.status in ('pending', 'preparing', 'sending', 'accepted') and coalesce(notification.send_started_at, notification.created_at) < now() - interval '10 minutes'),
    count(*) filter (where notification.status = 'delivered')
  from public.payment_notifications notification join public.orders payment_order on payment_order.id = notification.order_id
  where payment_order.status = 'paid';
end;
$$;
revoke all on function public.get_payment_notification_health() from public, anon, authenticated;
grant execute on function public.get_payment_notification_health() to service_role;

commit;
