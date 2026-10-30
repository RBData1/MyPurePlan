-- Local invoices live in the same register, without a QuickFile document.
alter table public.invoices
  add column if not exists source text not null default 'quickfile';

alter table public.invoices drop constraint if exists invoices_source_check;
alter table public.invoices
  add constraint invoices_source_check check (source in ('quickfile', 'local'));
