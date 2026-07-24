-- Tighten residual direct data access and add owner-only admin management RPCs.
-- Public read contracts that the app still uses remain in place; high-risk
-- ledger and audit fields are moved behind SECURITY DEFINER functions.

-- 1. Members should read the order ledger through get_my_order_ledger(), not
-- direct table select that exposes operational columns such as payment_key.
revoke select on table public.orders from authenticated;
drop policy if exists "Members can view own orders" on public.orders;

-- 2. Preserve creator audit fields even if an admin update payload includes
-- stale or forged created_by/created_at values.
create or replace function public.preserve_admin_creator_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by = coalesce(new.created_by, (select auth.uid()));
    return new;
  end if;

  new.created_by = old.created_by;
  new.created_at = old.created_at;
  return new;
end;
$$;

revoke all on function public.preserve_admin_creator_fields() from public, anon, authenticated;

drop trigger if exists products_preserve_admin_creator_fields on public.products;
create trigger products_preserve_admin_creator_fields
  before insert or update on public.products
  for each row execute function public.preserve_admin_creator_fields();

drop trigger if exists courses_preserve_admin_creator_fields on public.courses;
create trigger courses_preserve_admin_creator_fields
  before insert or update on public.courses
  for each row execute function public.preserve_admin_creator_fields();

drop trigger if exists course_sections_preserve_admin_creator_fields on public.course_sections;
create trigger course_sections_preserve_admin_creator_fields
  before insert or update on public.course_sections
  for each row execute function public.preserve_admin_creator_fields();

drop trigger if exists lessons_preserve_admin_creator_fields on public.lessons;
create trigger lessons_preserve_admin_creator_fields
  before insert or update on public.lessons
  for each row execute function public.preserve_admin_creator_fields();

-- 3. Owner-only admin management. RLS allows owner reads, but mutations should
-- be explicit audited RPCs and must not remove the last active owner.
create or replace function public.get_owner_admin_users()
returns table (
  user_id uuid,
  email text,
  role text,
  display_name text,
  is_active boolean,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    admin_user.user_id,
    account.email,
    admin_user.role,
    admin_user.display_name,
    admin_user.is_active,
    admin_user.created_by,
    admin_user.created_at,
    admin_user.updated_at
  from public.admin_users as admin_user
  left join auth.users as account on account.id = admin_user.user_id
  where public.is_admin(array['owner']::text[])
  order by admin_user.is_active desc, admin_user.role, admin_user.created_at desc;
$$;

create or replace function public.upsert_owner_admin_user(
  target_user_id uuid,
  target_role text,
  target_display_name text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  previous_role text;
  previous_active boolean;
begin
  if actor_id is null or not public.is_admin(array['owner']::text[]) then
    raise exception 'owner admin access required' using errcode = '42501';
  end if;

  if target_user_id is null or target_role not in ('owner', 'operator') then
    raise exception 'invalid admin user payload' using errcode = '22023';
  end if;

  if not exists (select 1 from auth.users where id = target_user_id) then
    raise exception 'target user not found' using errcode = 'P0002';
  end if;

  select role, is_active
    into previous_role, previous_active
  from public.admin_users
  where user_id = target_user_id;

  insert into public.admin_users (
    user_id,
    role,
    display_name,
    is_active,
    created_by,
    updated_at
  )
  values (
    target_user_id,
    target_role,
    nullif(trim(coalesce(target_display_name, '')), ''),
    true,
    actor_id,
    now()
  )
  on conflict (user_id)
  do update set
    role = excluded.role,
    display_name = excluded.display_name,
    is_active = true,
    updated_at = now();

  insert into public.admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    actor_id,
    'admin_user.upserted',
    'admin_user',
    target_user_id::text,
    jsonb_build_object(
      'previous_role', previous_role,
      'previous_active', previous_active,
      'role', target_role
    )
  );

  return true;
end;
$$;

create or replace function public.deactivate_owner_admin_user(target_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_role text;
begin
  if actor_id is null or not public.is_admin(array['owner']::text[]) then
    raise exception 'owner admin access required' using errcode = '42501';
  end if;

  if target_user_id is null then
    raise exception 'invalid admin user payload' using errcode = '22023';
  end if;

  select role
    into target_role
  from public.admin_users
  where user_id = target_user_id
    and is_active = true;

  if not found then
    return true;
  end if;

  if target_role = 'owner'
    and (
      select count(*)
      from public.admin_users
      where role = 'owner'
        and is_active = true
        and user_id <> target_user_id
    ) < 1 then
    raise exception 'cannot deactivate the last active owner' using errcode = '23514';
  end if;

  update public.admin_users
  set
    is_active = false,
    updated_at = now()
  where user_id = target_user_id;

  insert into public.admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    actor_id,
    'admin_user.deactivated',
    'admin_user',
    target_user_id::text,
    jsonb_build_object('previous_role', target_role)
  );

  return true;
end;
$$;

revoke all on function public.get_owner_admin_users() from public, anon, authenticated;
revoke all on function public.upsert_owner_admin_user(uuid, text, text) from public, anon, authenticated;
revoke all on function public.deactivate_owner_admin_user(uuid) from public, anon, authenticated;
grant execute on function public.get_owner_admin_users() to authenticated;
grant execute on function public.upsert_owner_admin_user(uuid, text, text) to authenticated;
grant execute on function public.deactivate_owner_admin_user(uuid) to authenticated;

comment on function public.get_owner_admin_users() is
  'Owner 전용 관리자 계정 조회 RPC. 이메일은 owner에게만 노출한다.';
comment on function public.upsert_owner_admin_user(uuid, text, text) is
  'Owner 전용 관리자 권한 부여/재활성화 RPC. 변경 사항을 감사 로그에 기록한다.';
comment on function public.deactivate_owner_admin_user(uuid) is
  'Owner 전용 관리자 비활성화 RPC. 마지막 active owner 비활성화는 거부한다.';

-- 4. Explicitly remove anon execution from authenticated/admin/service-only RPCs
-- whose earlier migrations relied on PUBLIC revocation semantics.
revoke all on function public.is_admin(text[]) from anon;
revoke all on function public.generate_order_uid() from anon;
revoke all on function public.claim_free_product(text) from anon;
revoke all on function public.has_active_product_entitlement(text) from anon;
revoke all on function public.get_my_active_product_entitlements() from anon;
revoke all on function public.can_access_course_video(text) from anon;
revoke all on function public.get_course_video_manifest(text) from anon;
revoke all on function public.get_my_active_product_library() from anon;
revoke all on function public.get_my_active_course_catalog_outline() from anon;
revoke all on function public.save_my_lesson_progress(text, text, integer, integer, text) from anon;
revoke all on function public.record_my_auth_consent(text, text, boolean, boolean) from anon;
revoke all on function public.update_my_marketing_consent(boolean) from anon;
revoke all on function public.create_toss_payment_order(text) from anon;
revoke all on function public.record_toss_refund_policy_consent(text, text) from anon;
revoke all on function public.fail_toss_payment_order(text) from anon;
revoke all on function public.get_my_order_ledger() from anon;
revoke all on function public.get_admin_order_ledger() from anon;
revoke all on function public.get_admin_refund_order_ledger() from anon;
revoke all on function public.get_admin_learning_progress() from anon;
revoke all on function public.get_admin_member_entitlements() from anon;
revoke all on function public.admin_grant_product_entitlement(uuid, uuid, timestamptz) from anon;
revoke all on function public.admin_update_product_entitlement(uuid, text, timestamptz) from anon;
revoke all on function public.move_course_section(uuid, integer) from anon;
revoke all on function public.move_lesson(uuid, integer) from anon;

revoke all on function public.complete_toss_payment_server(uuid, text, text, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_toss_payment_server(uuid, text, text, integer, timestamptz)
  to service_role;
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
