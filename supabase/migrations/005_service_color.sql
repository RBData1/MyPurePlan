-- Accent colour for each service (hex), used in customer UI and service lists.
alter table public.services
  add column if not exists color text;
