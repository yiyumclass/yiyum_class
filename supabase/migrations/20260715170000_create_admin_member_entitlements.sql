create or replace function public.get_admin_member_entitlements()
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
  access_period_days integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    account.id,
    coalesce(account.email, '이메일 정보 없음'),
    coalesce(
      nullif(account.raw_user_meta_data ->> 'nickname', ''),
      nullif(account.raw_user_meta_data ->> 'name', ''),
      nullif(split_part(coalesce(account.email, ''), '@', 1), ''),
      '이름 미등록'
    ),
    account.created_at,
    account.last_sign_in_at,
    entitlement.id,
    product.id,
    product.title,
    product.product_type,
    entitlement.source,
    entitlement.status,
    entitlement.granted_at,
    entitlement.expires_at,
    product.access_period_days
  from auth.users as account
  left join public.product_entitlements as entitlement
    on entitlement.user_id = account.id
  left join public.products as product
    on product.id = entitlement.product_id
  where public.is_admin()
    and account.deleted_at is null
  order by account.created_at desc, entitlement.granted_at desc nulls last;
$$;

comment on function public.get_admin_member_entitlements() is
  '활성 관리자가 회원과 회원별 수강권을 조회한다. 일반 회원에게는 실행 권한이 없다.';

revoke all on function public.get_admin_member_entitlements() from public;
grant execute on function public.get_admin_member_entitlements() to authenticated;

create or replace function public.admin_grant_product_entitlement(
  target_user_id uuid,
  target_product_id uuid,
  target_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_product public.products%rowtype;
  target_email text;
  result_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin permission required' using errcode = '42501';
  end if;

  select email into target_email
  from auth.users
  where id = target_user_id
    and deleted_at is null;

  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;

  select * into target_product
  from public.products
  where id = target_product_id
    and status <> 'archived';

  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  if target_expires_at is not null and target_expires_at <= now() then
    raise exception 'expiration must be in the future' using errcode = '22007';
  end if;

  insert into public.product_entitlements (
    user_id,
    product_id,
    source,
    status,
    granted_at,
    expires_at,
    updated_at
  )
  values (
    target_user_id,
    target_product_id,
    'admin_grant',
    'active',
    now(),
    target_expires_at,
    now()
  )
  on conflict (user_id, product_id) do update
  set
    source = 'admin_grant',
    status = 'active',
    granted_at = now(),
    expires_at = excluded.expires_at,
    updated_at = now()
  returning id into result_id;

  insert into public.admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    actor_id,
    'entitlement.granted',
    'product_entitlements',
    result_id::text,
    jsonb_build_object(
      'member_id', target_user_id,
      'member_email', target_email,
      'product_id', target_product_id,
      'product_title', target_product.title,
      'status', 'active',
      'expires_at', target_expires_at
    )
  );

  return result_id;
end;
$$;

comment on function public.admin_grant_product_entitlement(uuid, uuid, timestamptz) is
  '관리자가 회원에게 상품 수강권을 지급하거나 기존 수강권을 다시 활성화한다.';

revoke all on function public.admin_grant_product_entitlement(uuid, uuid, timestamptz) from public;
grant execute on function public.admin_grant_product_entitlement(uuid, uuid, timestamptz) to authenticated;

create or replace function public.admin_update_product_entitlement(
  target_entitlement_id uuid,
  target_status text,
  target_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_entitlement public.product_entitlements%rowtype;
  target_product public.products%rowtype;
  target_email text;
begin
  if not public.is_admin() then
    raise exception 'admin permission required' using errcode = '42501';
  end if;

  if target_status not in ('active', 'revoked') then
    raise exception 'invalid entitlement status' using errcode = '22023';
  end if;

  if target_status = 'active'
    and target_expires_at is not null
    and target_expires_at <= now() then
    raise exception 'expiration must be in the future' using errcode = '22007';
  end if;

  select * into current_entitlement
  from public.product_entitlements
  where id = target_entitlement_id;

  if not found then
    raise exception 'entitlement not found' using errcode = 'P0002';
  end if;

  select * into target_product
  from public.products
  where id = current_entitlement.product_id;

  select email into target_email
  from auth.users
  where id = current_entitlement.user_id;

  update public.product_entitlements
  set
    status = target_status,
    expires_at = target_expires_at,
    updated_at = now()
  where id = target_entitlement_id;

  insert into public.admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    actor_id,
    case when target_status = 'revoked'
      then 'entitlement.revoked'
      else 'entitlement.updated'
    end,
    'product_entitlements',
    target_entitlement_id::text,
    jsonb_build_object(
      'member_id', current_entitlement.user_id,
      'member_email', target_email,
      'product_id', current_entitlement.product_id,
      'product_title', target_product.title,
      'previous_status', current_entitlement.status,
      'status', target_status,
      'previous_expires_at', current_entitlement.expires_at,
      'expires_at', target_expires_at
    )
  );

  return target_entitlement_id;
end;
$$;

comment on function public.admin_update_product_entitlement(uuid, text, timestamptz) is
  '관리자가 수강권 상태와 만료일을 변경하고 감사 로그를 남긴다.';

revoke all on function public.admin_update_product_entitlement(uuid, text, timestamptz) from public;
grant execute on function public.admin_update_product_entitlement(uuid, text, timestamptz) to authenticated;
