update public.products
set price_krw = 0
where product_type in ('course', 'ebook')
  and price_krw <> 0;

insert into public.products (
  slug,
  product_type,
  title,
  summary,
  price_krw,
  access_period_days,
  status,
  detail_path
)
values (
  'small-account-ebook',
  'ebook',
  '작은 계정을 수익으로 연결하는 법',
  '수익화 계정의 방향과 실행 순서를 한 권에 정리한 실전 워크북',
  0,
  null,
  'active',
  '/checkout?product=small-account-ebook'
)
on conflict (slug) do update
set price_krw = 0;

update public.courses as course
set status = 'published'
where course.slug = 'sns-monetization'
  and course.status = 'draft'
  and exists (
    select 1
    from public.course_sections as section
    join public.lessons as lesson on lesson.section_id = section.id
    where section.course_id = course.id
      and section.status = 'published'
      and lesson.status = 'published'
      and lesson.video_path is not null
  )
  and not exists (
    select 1
    from public.course_sections as section
    join public.lessons as lesson on lesson.section_id = section.id
    where section.course_id = course.id
      and section.status = 'published'
      and lesson.status = 'published'
      and lesson.video_path is null
  );

create table if not exists public.product_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  source text not null default 'free_checkout'
    check (source in ('free_checkout', 'payment', 'admin_grant')),
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

comment on table public.product_entitlements is
  '사용자가 신청 또는 구매해 이용할 수 있는 강의·전자책 권한. 결제 도입 전에는 free_checkout으로 발급한다.';

create index if not exists product_entitlements_user_status_idx
  on public.product_entitlements (user_id, status, expires_at);

alter table public.product_entitlements enable row level security;
revoke all on table public.product_entitlements from anon, authenticated;
grant select on table public.product_entitlements to authenticated;

drop policy if exists "Members can view own product entitlements"
  on public.product_entitlements;
create policy "Members can view own product entitlements"
  on public.product_entitlements
  for select
  to authenticated
  using (user_id = (select auth.uid()));

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
  '로그인 사용자가 판매 중인 0원 상품을 즉시 신청하고 이용권을 발급받는다.';

revoke all on function public.claim_free_product(text) from public;
grant execute on function public.claim_free_product(text) to authenticated;

create or replace function public.has_active_product_entitlement(target_product_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.product_entitlements as entitlement
    join public.products as product on product.id = entitlement.product_id
    where entitlement.user_id = (select auth.uid())
      and product.slug = target_product_slug
      and entitlement.status = 'active'
      and (entitlement.expires_at is null or entitlement.expires_at > now())
  );
$$;

revoke all on function public.has_active_product_entitlement(text) from public;
grant execute on function public.has_active_product_entitlement(text) to authenticated;

create or replace function public.get_my_active_product_entitlements()
returns table (
  product_slug text,
  product_type text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    product.slug,
    product.product_type,
    entitlement.expires_at
  from public.product_entitlements as entitlement
  join public.products as product on product.id = entitlement.product_id
  where entitlement.user_id = (select auth.uid())
    and entitlement.status = 'active'
    and (entitlement.expires_at is null or entitlement.expires_at > now())
  order by entitlement.granted_at desc;
$$;

revoke all on function public.get_my_active_product_entitlements() from public;
grant execute on function public.get_my_active_product_entitlements() to authenticated;

create or replace function public.can_access_course_video(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.lessons as lesson
      join public.course_sections as section on section.id = lesson.section_id
      join public.courses as course on course.id = section.course_id
      join public.product_entitlements as entitlement
        on entitlement.product_id = course.product_id
       and entitlement.user_id = (select auth.uid())
       and entitlement.status = 'active'
       and (entitlement.expires_at is null or entitlement.expires_at > now())
      where lesson.video_provider = 'supabase'
        and lesson.video_path = object_name
        and course.status = 'published'
        and section.status = 'published'
        and (lesson.status = 'published' or lesson.is_preview = true)
    );
$$;

revoke all on function public.can_access_course_video(text) from public;
grant execute on function public.can_access_course_video(text) to authenticated;

create or replace function public.get_course_video_manifest(target_course_slug text)
returns table (
  lesson_key text,
  video_path text,
  video_provider text,
  duration_seconds integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    lesson.lesson_key,
    lesson.video_path,
    coalesce(
      lesson.video_provider,
      case when lesson.video_path like '/videos/%' then 'local' else 'supabase' end
    ),
    lesson.duration_seconds
  from public.lessons as lesson
  join public.course_sections as section on section.id = lesson.section_id
  join public.courses as course on course.id = section.course_id
  where course.slug = target_course_slug
    and lesson.video_path is not null
    and (
      public.is_admin()
      or (
        course.status = 'published'
        and section.status = 'published'
        and (lesson.status = 'published' or lesson.is_preview = true)
        and exists (
          select 1
          from public.product_entitlements as entitlement
          where entitlement.product_id = course.product_id
            and entitlement.user_id = (select auth.uid())
            and entitlement.status = 'active'
            and (entitlement.expires_at is null or entitlement.expires_at > now())
        )
      )
    )
  order by section.sort_order, lesson.sort_order;
$$;

revoke all on function public.get_course_video_manifest(text) from public;
grant execute on function public.get_course_video_manifest(text) to authenticated;
