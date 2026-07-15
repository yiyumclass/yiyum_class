create or replace function public.log_product_admin_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_metadata jsonb;
begin
  if tg_op = 'INSERT' then
    audit_metadata := jsonb_build_object(
      'slug', new.slug,
      'product_type', new.product_type,
      'status', new.status,
      'price_krw', new.price_krw,
      'access_period_days', new.access_period_days
    );
  else
    audit_metadata := jsonb_build_object(
      'slug', new.slug,
      'product_type', new.product_type,
      'changed_fields', to_jsonb(array_remove(array[
        case when old.title is distinct from new.title then 'title' end,
        case when old.summary is distinct from new.summary then 'summary' end,
        case when old.price_krw is distinct from new.price_krw then 'price_krw' end,
        case when old.access_period_days is distinct from new.access_period_days then 'access_period_days' end,
        case when old.status is distinct from new.status then 'status' end,
        case when old.thumbnail_path is distinct from new.thumbnail_path then 'thumbnail_path' end,
        case when old.detail_path is distinct from new.detail_path then 'detail_path' end
      ]::text[], null)),
      'before', jsonb_build_object(
        'title', old.title,
        'summary', old.summary,
        'price_krw', old.price_krw,
        'access_period_days', old.access_period_days,
        'status', old.status,
        'thumbnail_path', old.thumbnail_path,
        'detail_path', old.detail_path
      ),
      'after', jsonb_build_object(
        'title', new.title,
        'summary', new.summary,
        'price_krw', new.price_krw,
        'access_period_days', new.access_period_days,
        'status', new.status,
        'thumbnail_path', new.thumbnail_path,
        'detail_path', new.detail_path
      )
    );
  end if;

  insert into public.admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    (select auth.uid()),
    case tg_op
      when 'INSERT' then 'product.created'
      when 'UPDATE' then 'product.updated'
      else 'product.changed'
    end,
    'product',
    new.id::text,
    audit_metadata
  );

  return new;
end;
$$;

revoke all on function public.log_product_admin_change() from public;

comment on function public.log_product_admin_change() is
  '상품 등록·수정 시 변경 필드와 변경 전후 값을 관리자 감사 로그에 기록한다.';
