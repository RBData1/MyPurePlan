-- Secondary / alternate phone number (e.g. from Setmore Mobile + Phone).
alter table public.customers
  add column if not exists phone_secondary text;
