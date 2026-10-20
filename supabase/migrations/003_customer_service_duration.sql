-- Per-customer service duration (minutes) for the assigned service.
alter table public.customers
  add column if not exists service_duration_minutes integer
  check (service_duration_minutes is null or service_duration_minutes between 5 and 720);
