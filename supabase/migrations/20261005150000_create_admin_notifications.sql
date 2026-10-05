begin;

create table public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  entitlement_id uuid references public.product_entitlements(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  payment_notice boolean not null default false,
  template_id text not null check (length(template_id) between 1 and 80),
  template_name text not null,
  template_fingerprint text not null,
  channel_id text not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  variables jsonb not null check (jsonb_typeof(variables) = 'object'),
  recipient_hash text not null,
  recipient_masked text not null,
  status text not null default 'draft' check (status in ('draft', 'sending', 'accepted', 'rejected', 'unknown', 'delivered', 'delivery_failed', 'review')),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  send_started_at timestamptz,
  provider_message_id text,
  provider_group_id text,
  provider_status_code text,
  error_code text,
  delivery_checked_at timestamptz,
  delivery_check_after timestamptz not null default now(),
  delivered_at timestamptz
);

alter table public.admin_notifications enable row level security;
revoke all on public.admin_notifications from public, anon, authenticated;
grant select, insert, update, delete on public.admin_notifications to service_role;

create unique index admin_notifications_member_template_once
  on public.admin_notifications(user_id, template_id) where status <> 'draft';
create unique index admin_notifications_recipient_template_once
  on public.admin_notifications(recipient_hash, template_id, channel_id) where status <> 'draft';
create index admin_notifications_history on public.admin_notifications(user_id, created_at desc);
create index admin_notifications_delivery on public.admin_notifications(delivery_check_after)
  where status in ('sending', 'accepted', 'unknown');

create function public.begin_admin_notification_send(target_id uuid, actor_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  notice public.admin_notifications%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.admin_users admin join auth.users account on account.id = admin.user_id
    where admin.user_id = actor_id and admin.role = 'owner' and admin.is_active and account.deleted_at is null)
    or exists (select 1 from public.account_withdrawals where user_id = actor_id) then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  select * into notice from public.admin_notifications where id = target_id and actor_user_id = actor_id;
  if not found then raise exception 'draft_unavailable'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(notice.user_id::text, 0));
  select * into notice from public.admin_notifications where id = target_id for update;
  if notice.status <> 'draft' then return false; end if;
  if notice.expires_at <= now() then raise exception 'preview_expired'; end if;
  perform 1 from auth.users where id = notice.user_id and deleted_at is null for share;
  if not found or exists (select 1 from public.account_withdrawals where user_id = notice.user_id) then
    raise exception 'account_inactive';
  end if;
  if notice.entitlement_id is not null then
    perform 1 from public.product_entitlements entitlement
      where entitlement.id = notice.entitlement_id and entitlement.user_id = notice.user_id
        and entitlement.product_id = notice.product_id and entitlement.status = 'active'
        and (entitlement.expires_at is null or entitlement.expires_at > now())
        and (not notice.payment_notice or entitlement.source = 'admin_grant') for share;
    if not found then raise exception 'entitlement_unavailable'; end if;
  elsif notice.product_id is not null or notice.payment_notice then
    raise exception 'entitlement_unavailable';
  end if;
  if notice.payment_notice then
    if exists (select 1 from public.orders payment_order
      where payment_order.user_id = notice.user_id and payment_order.product_id = notice.product_id
        and payment_order.source = 'payment' and payment_order.status = 'paid') then
      raise exception 'automatic_payment_notice';
    end if;
    if exists (select 1 from public.payment_notifications notification
      join public.orders payment_order on payment_order.id = notification.order_id
      where payment_order.user_id = notice.user_id
        and (notification.template_id = notice.template_id or payment_order.product_id = notice.product_id)
        and (notification.send_started_at is not null or notification.provider_message_id is not null
          or notification.status in ('sending', 'accepted', 'unknown', 'delivered', 'delivery_failed', 'review'))) then
      raise exception 'duplicate_notification';
    end if;
  end if;
  if exists (select 1 from public.admin_notifications previous where previous.id <> target_id
    and previous.status <> 'draft' and previous.template_id = notice.template_id
    and (previous.user_id = notice.user_id or (previous.recipient_hash = notice.recipient_hash and previous.channel_id = notice.channel_id))) then
    raise exception 'duplicate_notification';
  end if;
  update public.admin_notifications set status = 'sending', send_started_at = now(), updated_at = now(),
    delivery_check_after = now() + interval '2 minutes' where id = target_id;
  insert into public.admin_audit_logs(actor_user_id, action, target_type, target_id, metadata)
    values(actor_id, 'notification.send', 'admin_notification', target_id::text,
      jsonb_build_object('user_id', notice.user_id, 'template_id', notice.template_id, 'recipient', notice.recipient_masked));
  return true;
end;
$$;
revoke all on function public.begin_admin_notification_send(uuid, uuid) from public, anon, authenticated;
grant execute on function public.begin_admin_notification_send(uuid, uuid) to service_role;

create function public.purge_withdrawn_admin_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'account_withdrawals' then
    delete from public.admin_notifications where user_id = new.user_id;
  elsif new.deleted_at is not null then
    delete from public.admin_notifications where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.purge_withdrawn_admin_notifications() from public, anon, authenticated;
create trigger purge_withdrawn_admin_notifications after insert on public.account_withdrawals
  for each row execute function public.purge_withdrawn_admin_notifications();
create trigger purge_deleted_admin_notifications after update of deleted_at on auth.users
  for each row execute function public.purge_withdrawn_admin_notifications();

create function public.guard_admin_notification_draft()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 0));
  perform 1 from auth.users where id = new.user_id and deleted_at is null for share;
  if not found or exists (select 1 from public.account_withdrawals where user_id = new.user_id) then
    raise exception 'account_inactive';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_admin_notification_draft() from public, anon, authenticated;
create trigger guard_admin_notification_draft before insert on public.admin_notifications
  for each row execute function public.guard_admin_notification_draft();

commit;
