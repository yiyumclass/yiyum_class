-- update_my_marketing_consent가 순수 UPDATE라 동의 행이 없는 사용자는 0행 갱신으로
-- 조용히 지나갔다. 호출부는 에러가 없으면 성공으로 판정하므로 화면에는 "저장됨"이
-- 보이지만 법적 기록에는 아무것도 남지 않았다.
--
-- 행이 없는 대상: (1) AUTH_CONSENT_ENFORCED_AT 이전 가입자,
-- (2) 콜백의 동의 게이트를 우회하는 관리자 계정.
--
-- 이들의 약관·개인정보 동의 버전은 실제로 기록된 적이 없다. 현재 버전에 동의한 것처럼
-- 꾸미면 오히려 허위 기록이 되므로, 버전은 'legacy-unrecorded' 센티넬로 남기고
-- 동의 시각은 계정 생성 시각으로 채운다. 마케팅 수신 여부만 지금 시각으로 기록한다.

create or replace function public.update_my_marketing_consent(
  marketing_opt_in boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  account_created_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  select created_at into account_created_at
  from auth.users
  where id = current_user_id;

  if not found then
    raise exception 'account not found'
      using errcode = 'P0002';
  end if;

  insert into public.user_auth_consents (
    user_id,
    terms_version,
    privacy_version,
    age14_confirmed_at,
    terms_agreed_at,
    privacy_agreed_at,
    marketing_opt_in,
    marketing_updated_at
  )
  values (
    current_user_id,
    'legacy-unrecorded',
    'legacy-unrecorded',
    account_created_at,
    account_created_at,
    account_created_at,
    update_my_marketing_consent.marketing_opt_in,
    now()
  )
  on conflict (user_id) do update
  set
    marketing_opt_in = update_my_marketing_consent.marketing_opt_in,
    marketing_updated_at = now(),
    updated_at = now();
end;
$$;

revoke all on function public.update_my_marketing_consent(boolean)
  from public, anon;
grant execute on function public.update_my_marketing_consent(boolean)
  to authenticated;
