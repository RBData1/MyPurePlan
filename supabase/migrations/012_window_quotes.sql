-- Window quotes, prospects, and confirmed unit-price revisions.
-- Run this once in the Supabase SQL editor.

create table if not exists public.window_quotes (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  client_name text not null default '',
  address text not null default '',
  postcode text not null default '',
  mode text not null default 'ai' check (mode in ('ai', 'manual')),
  outcome text not null default 'quoted' check (outcome in ('quoted', 'customer', 'prospect')),
  method text not null default 'wfp' check (method in ('wfp', 'traditional')),
  plan text not null default '4weeks' check (plan in ('oneoff', '4weeks', '8weeks')),
  window_count integer not null default 0,
  panels jsonb not null default '{"single":0,"double":0,"triple":0}'::jsonb,
  panel_prices jsonb not null default '{}'::jsonb,
  unit_rate numeric(10,2) not null default 0,
  first_clean_percent integer not null default 75,
  eight_week_percent integer not null default 25,
  price numeric(10,2) not null default 0,
  price_4 numeric(10,2) not null default 0,
  price_8 numeric(10,2) not null default 0,
  price_first numeric(10,2) not null default 0,
  addons jsonb not null default '[]'::jsonb,
  adjustments jsonb not null default '[]'::jsonb,
  comment text not null default '',
  notes text not null default '',
  property_type text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists window_quotes_business_created_idx on public.window_quotes (business_id, created_at desc);
create index if not exists window_quotes_customer_idx on public.window_quotes (business_id, customer_id);

create table if not exists public.window_price_revisions (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  single_price numeric(10,2) not null default 0,
  double_price numeric(10,2) not null default 0,
  triple_price numeric(10,2) not null default 0,
  wfp_rate numeric(10,2) not null default 0,
  trad_rate numeric(10,2) not null default 0,
  min_visit numeric(10,2) not null default 0,
  first_clean_percent integer not null default 75,
  eight_week_percent integer not null default 25
);

create index if not exists window_price_revisions_business_idx on public.window_price_revisions (business_id, confirmed_at desc);

alter table public.window_quotes enable row level security;
alter table public.window_price_revisions enable row level security;

drop policy if exists "Members manage window quotes" on public.window_quotes;
create policy "Members manage window quotes" on public.window_quotes
  for all to authenticated
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

drop policy if exists "Members manage window price revisions" on public.window_price_revisions;
create policy "Members manage window price revisions" on public.window_price_revisions
  for all to authenticated
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));
