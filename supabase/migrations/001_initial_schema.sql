-- MyPurePlan initial schema. Apply with Supabase CLI after creating a project.
create extension if not exists pgcrypto;

create type public.appointment_status as enum ('pending','confirmed','completed','cancelled');
create type public.member_role as enum ('owner','admin','staff');

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  email text,
  phone text,
  timezone text not null default 'Europe/London',
  currency char(3) not null default 'GBP',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (business_id,user_id)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  notes text,
  standard_price numeric(10,2) not null default 24 check (standard_price >= 0),
  frequency_weeks smallint not null default 6 check (frequency_weeks in (4,6,8,10,12)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  label text default 'Home',
  address_line_1 text not null,
  address_line_2 text,
  town text,
  postcode text not null,
  access_notes text,
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  default_duration_minutes integer not null default 30 check (default_duration_minutes between 5 and 720),
  default_price numeric(10,2) not null default 0 check (default_price >= 0),
  is_bookable_online boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id,name)
);

create table public.recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  address_id uuid not null references public.customer_addresses(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  interval_weeks integer not null check (interval_weeks in (4,6,8,10,12)),
  preferred_weekday smallint check (preferred_weekday between 0 and 6),
  preferred_time time,
  agreed_price numeric(10,2) not null check (agreed_price >= 0),
  next_due_date date,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  address_id uuid references public.customer_addresses(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  recurrence_rule_id uuid references public.recurrence_rules(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.appointment_status not null default 'pending',
  service_name_snapshot text not null,
  price_snapshot numeric(10,2) not null check (price_snapshot >= 0),
  address_snapshot text not null,
  customer_notes text,
  internal_notes text,
  booking_source text not null default 'manual' check (booking_source in ('manual','online','import','recurrence')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index appointments_business_starts_at_idx on public.appointments (business_id, starts_at);
create index appointments_customer_idx on public.appointments (business_id, customer_id);
create index customers_business_name_idx on public.customers (business_id, full_name);
create index addresses_business_postcode_idx on public.customer_addresses (business_id, postcode);

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  check (end_time > start_time)
);

create table public.blocked_periods (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  check (ends_at > starts_at)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  amount numeric(10,2) not null check (amount >= 0),
  paid_at timestamptz,
  method text,
  external_reference text,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  channel text not null check (channel in ('email','sms')),
  template_key text not null,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status text not null default 'queued' check (status in ('queued','sent','failed','cancelled')),
  provider_reference text,
  created_at timestamptz not null default now()
);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null,
  external_account_id text,
  status text not null default 'disconnected',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,provider)
);

-- Tenant isolation. Membership is the access boundary for every business-owned record.
create or replace function public.is_business_member(target_business_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.business_members bm where bm.business_id = target_business_id and bm.user_id = auth.uid()); $$;

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.customers enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.services enable row level security;
alter table public.recurrence_rules enable row level security;
alter table public.appointments enable row level security;
alter table public.availability_rules enable row level security;
alter table public.blocked_periods enable row level security;
alter table public.payments enable row level security;
alter table public.notifications enable row level security;
alter table public.integrations enable row level security;

create policy "Members can read their businesses" on public.businesses for select to authenticated using (public.is_business_member(id));
create policy "Members can update their businesses" on public.businesses for update to authenticated using (public.is_business_member(id)) with check (public.is_business_member(id));
create policy "Members can read memberships in their business" on public.business_members for select to authenticated using (public.is_business_member(business_id));

-- CRUD access to tenant-owned records. Role-sensitive writes should be tightened before production.
create policy "Members manage customers" on public.customers for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "Members manage customer addresses" on public.customer_addresses for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "Members manage services" on public.services for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "Members manage recurrence rules" on public.recurrence_rules for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "Members manage appointments" on public.appointments for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "Members manage availability" on public.availability_rules for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "Members manage blocked periods" on public.blocked_periods for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "Members manage payments" on public.payments for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "Members manage notifications" on public.notifications for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "Members manage integrations" on public.integrations for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

-- Important: public booking must be implemented through a validated server-side endpoint/RPC.
-- Do not expose a service-role key or enable anonymous direct writes to appointments.


-- Creates the first workspace safely for the currently authenticated user.
-- It also seeds the default services so the dashboard is ready to configure.
create or replace function public.create_business_for_current_user(business_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  new_business_id uuid;
  clean_name text := trim(coalesce(business_name, ''));
begin
  if current_user_id is null then
    raise exception 'You must be signed in to create a workspace.';
  end if;
  if clean_name = '' then
    raise exception 'Please enter a business name.';
  end if;

  -- Avoid accidentally creating multiple workspaces during a repeated request.
  select bm.business_id into new_business_id
  from public.business_members bm
  where bm.user_id = current_user_id
  order by bm.created_at asc
  limit 1;

  if new_business_id is not null then
    return new_business_id;
  end if;

  insert into public.businesses (name, email)
  values (clean_name, auth.jwt() ->> 'email')
  returning id into new_business_id;

  insert into public.business_members (business_id, user_id, role)
  values (new_business_id, current_user_id, 'owner');

  insert into public.services (business_id, name, default_duration_minutes, default_price, is_bookable_online)
  values
    (new_business_id, 'Window cleaning', 30, 24, true),
    (new_business_id, 'Windows + conservatory', 45, 38, true),
    (new_business_id, 'Gutter clearing', 60, 65, true),
    (new_business_id, 'Solar panel cleaning', 45, 50, true)
  on conflict (business_id, name) do nothing;

  return new_business_id;
end;
$$;

revoke all on function public.create_business_for_current_user(text) from public;
grant execute on function public.create_business_for_current_user(text) to authenticated;
