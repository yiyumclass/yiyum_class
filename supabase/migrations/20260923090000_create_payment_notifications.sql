-- 결제 트랜잭션과 함께 알림 작업을 기록한다. 과거 결제는 소급 발송하지 않는다.
create table public.payment_notifications (
  order_id uuid primary key references public.orders(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'preparing', 'sending', 'accepted', 'failed', 'unknown', 'skipped')),
  attempts integer not null default 0,
  attempt_id uuid,
  template_id text,
  provider_message_id text,
  provider_group_id text,
  error_code text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.payment_notifications enable row level security;
revoke all on public.payment_notifications from public, anon, authenticated;
grant select, insert, update on public.payment_notifications to service_role;
create index payment_notifications_pending_idx on public.payment_notifications(next_attempt_at)
  where status in ('pending', 'failed', 'preparing');

create function public.enqueue_payment_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'paid' and new.source = 'payment' and new.amount > 0
     and (tg_op = 'INSERT' or old.status is distinct from 'paid')
     and exists (select 1 from public.products p where p.id = new.product_id
       and p.slug in ('sns-monetization', 'sns-monetization-feedback', 'sns-monetization-ultra')) then
    insert into public.payment_notifications(order_id) values (new.id)
    on conflict (order_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.enqueue_payment_notification() from public, anon, authenticated;
create trigger enqueue_payment_notification after insert or update of status on public.orders
  for each row execute function public.enqueue_payment_notification();

-- 한 번에 1건을 점유한다. 잠금과 attempt_id로 동시 실행 및 만료된 작업자의 발송을 막는다.
create function public.claim_payment_notification(target_order_uid text default null)
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
        where e.user_id = o.user_id and e.product_id = o.product_id and e.status = 'active'
          and (e.expires_at is null or e.expires_at > now()))
    order by q.next_attempt_at, q.created_at
    limit 1 for update of q skip locked
  ) returning n.* into claimed;
  if not found then return; end if;
  return query select o.id, o.order_uid, o.user_id, p.slug, o.amount, o.approved_at, claimed.attempt_id
    from public.orders o join public.products p on p.id = o.product_id where o.id = claimed.order_id;
end;
$$;
revoke all on function public.claim_payment_notification(text) from public, anon, authenticated;
grant execute on function public.claim_payment_notification(text) to service_role;

-- 외부 발송 직전에 주문 상태·이용권·작업 토큰을 재확인한다.
create function public.begin_payment_notification_send(target_order_id uuid, target_attempt_id uuid, target_template_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.payment_notifications n set status = 'sending', template_id = target_template_id, updated_at = now()
  where n.order_id = target_order_id and n.attempt_id = target_attempt_id and n.status = 'preparing'
    and exists (select 1 from public.orders o join public.product_entitlements e
      on e.user_id = o.user_id and e.product_id = o.product_id
      where o.id = n.order_id and o.status = 'paid' and o.source = 'payment'
        and e.status = 'active' and (e.expires_at is null or e.expires_at > now()));
  return found;
end;
$$;
revoke all on function public.begin_payment_notification_send(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.begin_payment_notification_send(uuid, uuid, text) to service_role;
