begin;

create table payment_ops.notification_http_requests (
  request_id bigint primary key,
  requested_at timestamptz not null default now()
);
alter table payment_ops.notification_http_requests enable row level security;
revoke all on payment_ops.notification_http_requests from public, anon, authenticated, service_role;

create function payment_ops.invoke_payment_notifications()
returns bigint language plpgsql set search_path = '' as $$
declare
  recovery_url text;
  cron_secret text;
  notification_request_id bigint;
begin
  select decrypted_secret into recovery_url from vault.decrypted_secrets where name = 'yiyume_payment_recovery_url';
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'yiyume_payment_recovery_cron_secret';
  if recovery_url is null or recovery_url !~ '^https://[a-z0-9.-]+/api/cron/reconcile-payments$'
    or cron_secret is null or char_length(cron_secret) < 32 then
    raise exception 'notification scheduler configuration missing or invalid';
  end if;
  delete from payment_ops.notification_http_requests where requested_at < now() - interval '7 days';
  delete from cron.job_run_details where jobid in (select jobid from cron.job where jobname = 'yiyume-payment-notifications')
    and end_time < now() - interval '7 days';
  notification_request_id := net.http_get(
    url := replace(recovery_url, '/api/cron/reconcile-payments', '/api/cron/payment-notifications'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || cron_secret),
    timeout_milliseconds := 65000
  );
  insert into payment_ops.notification_http_requests(request_id) values (notification_request_id);
  return notification_request_id;
end;
$$;
revoke all on function payment_ops.invoke_payment_notifications() from public, anon, authenticated, service_role;

commit;
