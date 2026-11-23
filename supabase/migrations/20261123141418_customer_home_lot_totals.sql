-- SECURITY INVOKER preserves the existing lots RLS.
create or replace function public.get_customer_home_lot_totals(p_customer_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$
 select jsonb_build_object(
  'total',count(*),
  'paid',count(*) filter(where status in ('paid','shipped','delivered')),
  'awaiting_shipment',count(*) filter(where status='paid')
 )
 from public.lots
 where customer_id=p_customer_id and payment_expired_at is null;
$$;
revoke all on function public.get_customer_home_lot_totals(uuid) from public, anon;
grant execute on function public.get_customer_home_lot_totals(uuid) to authenticated, service_role;
