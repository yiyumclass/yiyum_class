-- 수강권 발급·변경 함수와 updated_at 관리를 보강한다.
-- 기존 마이그레이션 본문은 수정하지 않고, 여기서 create or replace로 재정의한다.
--
-- 1. 최초 발급 시각(granted_at) 보존: 재지급·재신청 시 최초 발급 시각을 덮어쓰지 않는다.
--    재지급 이력은 admin_audit_logs가 담당한다.
-- 2. 지급·변경·회수는 owner 전용으로 좁힌다. 조회 함수(get_admin_*)는 기존 권한을 유지한다.
-- 3. product_entitlements, lesson_progress에 updated_at 자동 갱신 트리거를 추가한다.

-- 공용 updated_at 갱신 트리거 함수.
-- set_products_updated_at는 products 전용 updated_by 컬럼도 갱신하므로 해당 컬럼이 없는
-- 두 테이블에는 재사용할 수 없어, 같은 패턴의 범용 함수를 두어 두 트리거가 공유한다.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'updated_at 컬럼을 현재 시각으로 갱신하는 공용 before update 트리거 함수.';

drop trigger if exists product_entitlements_set_updated_at
  on public.product_entitlements;
create trigger product_entitlements_set_updated_at
  before update on public.product_entitlements
  for each row execute function public.set_updated_at();

drop trigger if exists lesson_progress_set_updated_at
  on public.lesson_progress;
create trigger lesson_progress_set_updated_at
  before update on public.lesson_progress
  for each row execute function public.set_updated_at();

-- 0원 상품 즉시 신청. on conflict 시 granted_at을 갱신하지 않아 최초 발급 시각을 보존한다.
create or replace function public.claim_free_product(target_product_slug text)
returns table (
  product_slug text,
  product_type text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_product public.products%rowtype;
  entitlement_expires_at timestamptz;
begin
  if actor_id is null then
    raise exception 'authentication required';
  end if;

  select * into target_product
  from public.products
  where slug = target_product_slug
    and status = 'active';

  if not found then
    raise exception 'active product not found';
  end if;
  if target_product.price_krw <> 0 then
    raise exception 'product is not free';
  end if;

  entitlement_expires_at := case
    when target_product.access_period_days is null then null
    else now() + make_interval(days => target_product.access_period_days)
  end;

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
    actor_id,
    target_product.id,
    'free_checkout',
    'active',
    now(),
    entitlement_expires_at,
    now()
  )
  on conflict (user_id, product_id) do update
  set
    source = 'free_checkout',
    status = 'active',
    -- granted_at은 갱신하지 않는다: 재신청 시 최초 발급 시각을 보존한다.
    expires_at = excluded.expires_at,
    updated_at = now();

  return query
  select
    target_product.slug,
    target_product.product_type,
    entitlement_expires_at;
end;
$$;

comment on function public.claim_free_product(text) is
  '로그인 사용자가 판매 중인 0원 상품을 즉시 신청하고 이용권을 발급받는다. 재신청 시 최초 발급 시각을 보존한다.';

revoke all on function public.claim_free_product(text) from public;
grant execute on function public.claim_free_product(text) to authenticated;

-- 관리자 수강권 지급. owner 전용으로 좁히고, on conflict 시 granted_at을 보존한다.
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
  if not public.is_admin(array['owner']::text[]) then
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
    -- granted_at은 갱신하지 않는다: 재지급 시 최초 발급 시각을 보존한다.
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
  'owner가 회원에게 상품 수강권을 지급하거나 기존 수강권을 다시 활성화한다. 재지급 시 최초 발급 시각을 보존한다.';

revoke all on function public.admin_grant_product_entitlement(uuid, uuid, timestamptz) from public;
grant execute on function public.admin_grant_product_entitlement(uuid, uuid, timestamptz) to authenticated;

-- 관리자 수강권 상태·만료일 변경. owner 전용으로 좁힌다.
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
  if not public.is_admin(array['owner']::text[]) then
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
  'owner가 수강권 상태와 만료일을 변경하고 감사 로그를 남긴다.';

revoke all on function public.admin_update_product_entitlement(uuid, text, timestamptz) from public;
grant execute on function public.admin_update_product_entitlement(uuid, text, timestamptz) to authenticated;
