-- Fast, membership-checked customer delete (avoids statement timeouts from many round-trips).
create or replace function public.delete_customer_cascade(
  p_business_id uuid,
  p_customer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'not allowed';
  end if;

  delete from public.payments p
  using public.appointments a
  where p.appointment_id = a.id
    and p.business_id = p_business_id
    and a.business_id = p_business_id
    and a.customer_id = p_customer_id;

  delete from public.notifications n
  using public.appointments a
  where n.appointment_id = a.id
    and n.business_id = p_business_id
    and a.business_id = p_business_id
    and a.customer_id = p_customer_id;

  delete from public.appointments
  where business_id = p_business_id
    and customer_id = p_customer_id;

  delete from public.recurrence_rules
  where business_id = p_business_id
    and customer_id = p_customer_id;

  delete from public.customer_addresses
  where business_id = p_business_id
    and customer_id = p_customer_id;

  delete from public.customers
  where business_id = p_business_id
    and id = p_customer_id;
end;
$$;

revoke all on function public.delete_customer_cascade(uuid, uuid) from public;
grant execute on function public.delete_customer_cascade(uuid, uuid) to authenticated;
