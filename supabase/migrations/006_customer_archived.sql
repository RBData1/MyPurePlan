-- Past / inactive customers stay in the database but are hidden from the active schedule list.
alter table public.customers
  add column if not exists archived boolean not null default false;

create index if not exists customers_business_archived_idx
  on public.customers (business_id, archived);
