-- QuickFile client link on customers (optional; app also keeps a local cache).
alter table public.customers
  add column if not exists quickfile_client_id bigint;

-- Invoice reference stored on appointments for Done → QuickFile flow.
alter table public.appointments
  add column if not exists quickfile_invoice_id bigint,
  add column if not exists quickfile_invoice_number text,
  add column if not exists quickfile_invoiced_at timestamptz;
