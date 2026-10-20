-- Multiple assigned services per customer (name, price, duration).
alter table public.customers
  add column if not exists assigned_services jsonb;
