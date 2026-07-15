create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  product_type text not null
    check (product_type in ('course', 'ebook')),
  title text not null,
  summary text not null default '',
  price_krw integer not null default 0
    check (price_krw >= 0),
  access_period_days integer
    check (access_period_days is null or access_period_days > 0),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'archived')),
  thumbnail_path text,
  detail_path text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_slug_format_check
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint products_title_length_check
    check (char_length(title) between 1 and 120),
  constraint products_summary_length_check
    check (char_length(summary) <= 500)
);

comment on table public.products is
  '강의와 전자책의 판매 단위. 실제 콘텐츠와 수강권은 별도 테이블로 연결한다.';
comment on column public.products.access_period_days is
  'null이면 이용 기간 제한 없음, 숫자이면 구매 또는 지급 시점부터의 이용 일수';
comment on column public.products.status is
  'draft 작성 중, active 판매 중, paused 판매 중지, archived 보관';

create index if not exists products_status_updated_at_idx
  on public.products (status, updated_at desc);
create index if not exists products_type_status_idx
  on public.products (product_type, status);

create or replace function public.set_products_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.updated_by = (select auth.uid());
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_products_updated_at();

alter table public.products enable row level security;

revoke all on table public.products from anon, authenticated;
grant select on table public.products to anon, authenticated;
grant insert, update on table public.products to authenticated;

drop policy if exists "Public can view active products"
  on public.products;
create policy "Public can view active products"
  on public.products
  for select
  to anon, authenticated
  using (status = 'active');

drop policy if exists "Admins can view all products"
  on public.products;
create policy "Admins can view all products"
  on public.products
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Admins can create products"
  on public.products;
create policy "Admins can create products"
  on public.products
  for insert
  to authenticated
  with check (
    public.is_admin()
    and created_by = (select auth.uid())
  );

drop policy if exists "Admins can update products"
  on public.products;
create policy "Admins can update products"
  on public.products
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.log_product_admin_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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
    jsonb_build_object(
      'slug', new.slug,
      'product_type', new.product_type,
      'previous_status', case when tg_op = 'UPDATE' then old.status else null end,
      'status', new.status
    )
  );

  return new;
end;
$$;

revoke all on function public.log_product_admin_change() from public;

drop trigger if exists products_write_audit_log on public.products;
create trigger products_write_audit_log
  after insert or update on public.products
  for each row execute function public.log_product_admin_change();

insert into public.products (
  slug,
  product_type,
  title,
  summary,
  price_krw,
  access_period_days,
  status,
  thumbnail_path,
  detail_path
)
values (
  'sns-monetization',
  'course',
  '이윰 SNS 수익화 클래스',
  '계정 세팅부터 콘텐츠, 알고리즘, 수익화와 브랜딩까지 작은 계정을 수익으로 연결하는 전 과정을 배웁니다.',
  300000,
  365,
  'active',
  '/assets/profile.jpg',
  '/courses'
)
on conflict (slug) do nothing;
