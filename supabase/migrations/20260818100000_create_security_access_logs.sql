-- 로그인 접속기록은 장애 분석용 플랫폼 로그와 분리하여 애플리케이션이 직접 관리한다.
-- 원문 이메일이나 OAuth 코드·토큰은 저장하지 않고, 식별값은 SHA-256 해시로만 남긴다.
-- 모든 행은 발생 시점부터 3개월 뒤 자동 파기 대상이 된다.

create extension if not exists pgcrypto with schema extensions;
create table if not exists public.security_access_logs (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('kakao', 'email')),
  outcome text not null check (outcome in ('success', 'failure', 'blocked')),
  subject_hash text check (
    subject_hash is null or subject_hash ~ '^[0-9a-f]{64}$'
  ),
  ip_address inet,
  user_agent text check (
    user_agent is null or char_length(user_agent) <= 512
  ),
  request_id text check (
    request_id is null or char_length(request_id) <= 128
  ),
  failure_code text check (
    failure_code is null or failure_code ~ '^[a-z0-9_]{1,64}$'
  ),
  occurred_at timestamptz not null,
  retain_until timestamptz not null,
  created_at timestamptz not null default now(),
  check (retain_until > occurred_at),
  check (
    (outcome = 'success' and failure_code is null)
    or (outcome <> 'success' and failure_code is not null)
  )
);
create index if not exists security_access_logs_occurred_at_idx
  on public.security_access_logs (occurred_at desc);
create index if not exists security_access_logs_retain_until_idx
  on public.security_access_logs (retain_until);
create index if not exists security_access_logs_subject_hash_idx
  on public.security_access_logs (subject_hash, occurred_at desc)
  where subject_hash is not null;
comment on table public.security_access_logs is
  '로그인 성공·실패·차단 접속기록. 최소 보안정보만 서버 전용으로 3개월 보관한다.';
comment on column public.security_access_logs.subject_hash is
  'provider와 정규화한 계정 식별값을 SHA-256 처리한 값. 원문 이메일·사용자 ID는 저장하지 않는다.';
comment on column public.security_access_logs.ip_address is
  '신뢰하는 프록시가 전달한 접속 IP. 요청 헤더가 유효한 IP 형식일 때만 기록한다.';
comment on column public.security_access_logs.retain_until is
  'occurred_at으로부터 3개월 뒤의 자동 파기 시각.';
alter table public.security_access_logs enable row level security;
-- 브라우저와 일반 회원은 접속기록의 존재 여부조차 직접 조회할 수 없다.
revoke all on table public.security_access_logs from public, anon, authenticated;
create or replace function public.record_security_access_log_server(
  p_provider text,
  p_outcome text,
  p_subject text default null,
  p_ip_address inet default null,
  p_user_agent text default null,
  p_request_id text default null,
  p_failure_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_time timestamptz := clock_timestamp();
  normalized_subject text := nullif(lower(btrim(coalesce(p_subject, ''))), '');
  inserted_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_provider not in ('kakao', 'email') then
    raise exception 'unsupported login provider' using errcode = '22023';
  end if;

  if p_outcome not in ('success', 'failure', 'blocked') then
    raise exception 'unsupported login outcome' using errcode = '22023';
  end if;

  if p_outcome = 'success' and p_failure_code is not null then
    raise exception 'successful login cannot have a failure code' using errcode = '22023';
  end if;

  if p_outcome <> 'success' and nullif(btrim(coalesce(p_failure_code, '')), '') is null then
    raise exception 'failed or blocked login requires a failure code' using errcode = '22023';
  end if;

  insert into public.security_access_logs (
    provider,
    outcome,
    subject_hash,
    ip_address,
    user_agent,
    request_id,
    failure_code,
    occurred_at,
    retain_until
  )
  values (
    p_provider,
    p_outcome,
    case
      when normalized_subject is null then null
      else pg_catalog.encode(
        extensions.digest(p_provider || ':' || normalized_subject, 'sha256'),
        'hex'
      )
    end,
    p_ip_address,
    left(nullif(btrim(coalesce(p_user_agent, '')), ''), 512),
    left(nullif(btrim(coalesce(p_request_id, '')), ''), 128),
    case
      when p_outcome = 'success' then null
      else left(lower(btrim(p_failure_code)), 64)
    end,
    event_time,
    event_time + interval '3 months'
  )
  returning id into inserted_id;

  return inserted_id;
end;
$$;
revoke all on function public.record_security_access_log_server(
  text, text, text, inet, text, text, text
) from public, anon, authenticated;
grant execute on function public.record_security_access_log_server(
  text, text, text, inet, text, text, text
) to service_role;
comment on function public.record_security_access_log_server(
  text, text, text, inet, text, text, text
) is
  'service_role 전용 로그인 접속기록 생성. 계정 식별값은 해시하고 3개월 파기시각을 서버에서 고정한다.';
create or replace function public.purge_expired_security_access_logs_server()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  delete from public.security_access_logs
  where retain_until <= clock_timestamp();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
revoke all on function public.purge_expired_security_access_logs_server()
  from public, anon, authenticated;
grant execute on function public.purge_expired_security_access_logs_server()
  to service_role;
comment on function public.purge_expired_security_access_logs_server() is
  'service_role cron 전용. 발생 후 3개월이 지난 로그인 접속기록을 복구 불가능하도록 삭제한다.';
