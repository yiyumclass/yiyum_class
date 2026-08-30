-- Grant the existing service owner full admin access.
--
-- This is intentionally idempotent so the migration can be replayed safely.
-- A clean local database does not contain the production Auth user, so a
-- missing account is reported and skipped instead of breaking db reset.
do $$
declare
  target_user_id uuid;
begin
  select account.id
    into target_user_id
  from auth.users as account
  where lower(account.email) = lower('ymyi98@naver.com')
    and account.deleted_at is null
  order by account.created_at asc
  limit 1;

  if target_user_id is null then
    raise notice 'Admin bootstrap skipped: ymyi98@naver.com was not found in auth.users.';
    return;
  end if;

  insert into public.admin_users (
    user_id,
    role,
    display_name,
    is_active,
    created_by
  )
  values (
    target_user_id,
    'owner',
    '이윰',
    true,
    target_user_id
  )
  on conflict (user_id)
  do update set
    role = excluded.role,
    display_name = coalesce(
      nullif(btrim(public.admin_users.display_name), ''),
      excluded.display_name
    ),
    is_active = true,
    updated_at = now();

  raise notice 'Owner admin access granted to ymyi98@naver.com.';
end;
$$;
