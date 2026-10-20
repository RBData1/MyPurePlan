-- Preferred service assignment for each customer (used by Services and Customers views).
alter table public.customers
  add column if not exists preferred_service text;

create index if not exists customers_business_preferred_service_idx
  on public.customers (business_id, preferred_service);
