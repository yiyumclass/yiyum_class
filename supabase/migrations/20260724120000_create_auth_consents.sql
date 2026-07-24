create table if not exists public.user_auth_consents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  age14_confirmed_at timestamptz not null,
  terms_agreed_at timestamptz not null,
  privacy_agreed_at timestamptz not null,
  marketing_opt_in boolean not null default false,
  marketing_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_auth_consents_terms_version_length
    check (char_length(terms_version) between 1 and 40),
  constraint user_auth_consents_privacy_version_length
    check (char_length(privacy_version) between 1 and 40)
);

comment on table public.user_auth_consents is
  '회원가입 필수 약관, 개인정보, 연령 확인과 마케팅 수신 선택의 현재 동의 상태';

alter table public.user_auth_consents enable row level security;

revoke all on table public.user_auth_consents from anon;
revoke all on table public.user_auth_consents from authenticated;

grant select on table public.user_auth_consents to authenticated;

drop policy if exists "Users can view their own auth consent"
  on public.user_auth_consents;
create policy "Users can view their own auth consent"
  on public.user_auth_consents
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.record_my_auth_consent(
  terms_version text,
  privacy_version text,
  age14_confirmed boolean,
  marketing_opt_in boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  consented_at timestamptz := now();
begin
  if current_user_id is null then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  if age14_confirmed is not true
    or terms_version is null
    or char_length(terms_version) < 1
    or char_length(terms_version) > 40
    or privacy_version is null
    or char_length(privacy_version) < 1
    or char_length(privacy_version) > 40 then
    raise exception 'Required consent is missing'
      using errcode = '22023';
  end if;

  insert into public.user_auth_consents (
    user_id,
    terms_version,
    privacy_version,
    age14_confirmed_at,
    terms_agreed_at,
    privacy_agreed_at,
    marketing_opt_in,
    marketing_updated_at,
    updated_at
  )
  values (
    current_user_id,
    record_my_auth_consent.terms_version,
    record_my_auth_consent.privacy_version,
    consented_at,
    consented_at,
    consented_at,
    record_my_auth_consent.marketing_opt_in,
    consented_at,
    consented_at
  )
  on conflict (user_id)
  do update set
    terms_version = excluded.terms_version,
    privacy_version = excluded.privacy_version,
    age14_confirmed_at = coalesce(
      public.user_auth_consents.age14_confirmed_at,
      excluded.age14_confirmed_at
    ),
    terms_agreed_at = coalesce(
      public.user_auth_consents.terms_agreed_at,
      excluded.terms_agreed_at
    ),
    privacy_agreed_at = coalesce(
      public.user_auth_consents.privacy_agreed_at,
      excluded.privacy_agreed_at
    ),
    marketing_opt_in = excluded.marketing_opt_in,
    marketing_updated_at = excluded.marketing_updated_at,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function public.update_my_marketing_consent(marketing_opt_in boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  update public.user_auth_consents
  set
    marketing_opt_in = update_my_marketing_consent.marketing_opt_in,
    marketing_updated_at = now(),
    updated_at = now()
  where user_id = current_user_id;
end;
$$;

revoke all on function public.record_my_auth_consent(text, text, boolean, boolean)
  from public, anon;
revoke all on function public.update_my_marketing_consent(boolean)
  from public, anon;
grant execute on function public.record_my_auth_consent(text, text, boolean, boolean)
  to authenticated;
grant execute on function public.update_my_marketing_consent(boolean)
  to authenticated;
