begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create schema if not exists payment_ops;
revoke all on schema payment_ops from public, anon, authenticated, service_role;

create table if not exists payment_ops.recovery_http_requests (
  request_id bigint primary key,
  requested_at timestamptz not null default now()
);

revoke all on payment_ops.recovery_http_requests from public, anon, authenticated, service_role;
revoke all on net.http_request_queue, net._http_response from public, anon, authenticated;

create or replace function payment_ops.invoke_payment_recovery()
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  recovery_url text;
  recovery_secret text;
  recovery_request_id bigint;
begin
  select decrypted_secret into recovery_url
  from vault.decrypted_secrets where name = 'yiyume_payment_recovery_url';
  select decrypted_secret into recovery_secret
  from vault.decrypted_secrets where name = 'yiyume_payment_recovery_cron_secret';

  if recovery_url is null
    or recovery_url !~ '^https://[a-z0-9.-]+/api/cron/reconcile-payments$'
    or recovery_secret is null or char_length(recovery_secret) < 32 then
    raise exception 'payment recovery scheduler configuration missing or invalid';
  end if;

  delete from payment_ops.recovery_http_requests
  where requested_at < now() - interval '7 days';
  delete from cron.job_run_details
  where jobid in (select jobid from cron.job where jobname = 'yiyume-payment-recovery')
    and end_time < now() - interval '7 days';

  recovery_request_id := net.http_get(
    url := recovery_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || recovery_secret),
    timeout_milliseconds := 65000
  );

  insert into payment_ops.recovery_http_requests(request_id)
  values (recovery_request_id);
  return recovery_request_id;
end;
$$;

revoke all on function payment_ops.invoke_payment_recovery() from public, anon, authenticated, service_role;

commit;
