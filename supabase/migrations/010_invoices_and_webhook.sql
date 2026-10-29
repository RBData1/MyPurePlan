-- Invoice register and QuickFile payment webhook.
-- Run this once in the Supabase SQL editor.

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  customer_name text not null default '',
  service_name text not null default '',
  address text not null default '',
  job_date date,
  amount numeric(10,2) not null default 0 check (amount >= 0),
  quickfile_invoice_id bigint not null,
  quickfile_invoice_number text,
  issued_at timestamptz not null default now(),
  due_at date,
  status text not null default 'unpaid' check (status in ('unpaid','paid','void')),
  paid_at timestamptz,
  paid_amount numeric(10,2),
  payment_method text,
  quickfile_payment_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, quickfile_invoice_id)
);

create table if not exists public.quickfile_webhook_events (
  hook_id text primary key,
  received_at timestamptz not null default now()
);

alter table public.invoices enable row level security;
alter table public.quickfile_webhook_events enable row level security;

drop policy if exists "Members manage invoices" on public.invoices;
create policy "Members manage invoices" on public.invoices
  for all to authenticated
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

create or replace function public.apply_quickfile_webhook(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  body jsonb := coalesce(payload->'PayLoad', payload->'Payload', payload);
  hook text := coalesce(body->>'Hookid', body->>'HookId', body->>'hookid');
  signature text := coalesce(body->>'Signature', body->>'signature');
  match_business uuid;
  acc text;
  secret text;
  expected text;
  events jsonb;
  item jsonb;
  invoice_id bigint;
  payment_id bigint;
  v_paid numeric;
  v_paid_at timestamptz;
  v_method text;
  applied int := 0;
begin
  if hook is null or signature is null or hook = '' or signature = '' then
    return jsonb_build_object('ok', false, 'error', 'Missing webhook signature');
  end if;

  if exists (select 1 from public.quickfile_webhook_events where hook_id = hook) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  for match_business, acc, secret in
    select i.business_id, i.settings->>'accNumber', i.settings->>'webhookSecret'
    from public.integrations i
    where i.provider = 'quickfile'
      and coalesce(i.settings->>'webhookSecret', '') <> ''
      and coalesce(i.settings->>'accNumber', '') <> ''
  loop
    expected := md5(hook || secret || acc);
    if lower(expected) = lower(signature) then
      exit;
    end if;
    match_business := null;
  end loop;

  if match_business is null then
    return jsonb_build_object('ok', false, 'error', 'Webhook signature did not match the saved QuickFile secret');
  end if;

  -- Paid online, payment tagged to an invoice, or a sales payment.
  for events in
    select value from jsonb_array_elements(jsonb_build_array(
      body->'InvoicesPaid',
      body->'InvoicesPayment',
      body->'PaymentsCreated'
    ))
  loop
    if events is null then continue; end if;
    if jsonb_typeof(events) = 'object' then events := jsonb_build_array(events); end if;
    if jsonb_typeof(events) <> 'array' then continue; end if;
    for item in select value from jsonb_array_elements(events)
    loop
      invoice_id := coalesce((item->>'Id')::bigint, (item->>'InvoiceId')::bigint, (item->>'InvoiceID')::bigint);
      payment_id := coalesce((item->>'PaymentId')::bigint, (item->>'PaymentID')::bigint);
      v_paid := nullif(item->>'AmountPaid', '')::numeric;
      v_method := coalesce(nullif(item->>'PaymentMethod', ''), 'quickfile');
      begin
        v_paid_at := nullif(item->>'TimeStamp', '')::timestamptz;
      exception when others then
        v_paid_at := now();
      end;
      if v_paid_at is null then v_paid_at := now(); end if;
      if invoice_id is null then continue; end if;

      insert into public.invoices (
        business_id, appointment_id, customer_name, service_name, address, job_date, amount,
        quickfile_invoice_id, quickfile_invoice_number, issued_at, due_at, status, paid_at, paid_amount, payment_method, quickfile_payment_id
      )
      select
        a.business_id, a.id, coalesce(c.full_name, 'Customer'), coalesce(a.service_name_snapshot, 'Service'), coalesce(a.address_snapshot, ''),
        (a.starts_at at time zone 'Europe/London')::date, a.price_snapshot,
        a.quickfile_invoice_id, a.quickfile_invoice_number, coalesce(a.quickfile_invoiced_at, v_paid_at),
        (coalesce(a.quickfile_invoiced_at, v_paid_at)::date + 14),
        'paid', v_paid_at, coalesce(v_paid, a.price_snapshot), v_method, payment_id
      from public.appointments a
      left join public.customers c on c.id = a.customer_id
      where a.business_id = match_business and a.quickfile_invoice_id = invoice_id
      on conflict (business_id, quickfile_invoice_id) do update set
        status = 'paid',
        paid_at = excluded.paid_at,
        paid_amount = coalesce(excluded.paid_amount, public.invoices.paid_amount, public.invoices.amount),
        payment_method = excluded.payment_method,
        quickfile_payment_id = coalesce(excluded.quickfile_payment_id, public.invoices.quickfile_payment_id),
        updated_at = now();

      update public.invoices as saved
      set status = 'paid',
          paid_at = v_paid_at,
          paid_amount = coalesce(v_paid, saved.paid_amount, saved.amount),
          payment_method = v_method,
          quickfile_payment_id = coalesce(payment_id, saved.quickfile_payment_id),
          updated_at = now()
      where saved.business_id = match_business and saved.quickfile_invoice_id = invoice_id;

      insert into public.payments (business_id, appointment_id, amount, paid_at, method, external_reference)
      select i.business_id, i.appointment_id, coalesce(i.paid_amount, i.amount), v_paid_at, v_method, 'qf:' || invoice_id::text
      from public.invoices i
      where i.business_id = match_business
        and i.quickfile_invoice_id = invoice_id
        and i.appointment_id is not null
        and not exists (
          select 1 from public.payments p
          where p.business_id = i.business_id and p.external_reference = 'qf:' || invoice_id::text
        );

      applied := applied + 1;
    end loop;
  end loop;

  events := body->'InvoicesDeleted';
  if events is not null then
    if jsonb_typeof(events) = 'object' then events := jsonb_build_array(events); end if;
    if jsonb_typeof(events) = 'array' then
      for item in select value from jsonb_array_elements(events)
      loop
        invoice_id := coalesce((item->>'Id')::bigint, (item->>'InvoiceId')::bigint);
        if invoice_id is null then continue; end if;
        update public.invoices
        set status = 'void', updated_at = now()
        where business_id = match_business and quickfile_invoice_id = invoice_id and status <> 'paid';
        applied := applied + 1;
      end loop;
    end if;
  end if;

  insert into public.quickfile_webhook_events(hook_id) values (hook) on conflict do nothing;
  return jsonb_build_object('ok', true, 'applied', applied);
end;
$$;

revoke all on function public.apply_quickfile_webhook(jsonb) from public;
grant execute on function public.apply_quickfile_webhook(jsonb) to anon, authenticated;
