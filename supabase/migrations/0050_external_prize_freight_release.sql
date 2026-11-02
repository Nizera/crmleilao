begin;
create table public.external_prize_freight_releases(
 lot_id uuid primary key references public.lots(id),customer_id uuid not null references public.customers(id),
 actor uuid not null references public.admin_profiles(id),reason text not null check(length(reason) between 5 and 500),created_at timestamptz not null default now());
alter table public.external_prize_freight_releases enable row level security;
revoke all on public.external_prize_freight_releases from public,anon,authenticated;
grant select on public.external_prize_freight_releases to authenticated;
grant all on public.external_prize_freight_releases to service_role;
create policy external_prize_release_staff on public.external_prize_freight_releases for select to authenticated using(public.is_admin());
create function public.release_external_prize_freight(p_customer uuid,p_lots uuid[],p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if not public.has_staff_write() then raise exception 'Acesso negado.' using errcode='42501';end if;
 if p_lots is null or cardinality(p_lots) not between 1 and 500 or p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'Informe os prêmios e o motivo da liberação.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text,0));
 perform id from public.lots where id=any(p_lots) order by id for update;
 select count(*) into n from public.lots l where l.id=any(p_lots) and l.customer_id=p_customer and l.arremate_value=0 and l.status in('paid','pending_payment') and l.charge_id is null
 and not exists(select 1 from public.shipment_lots sl join public.shipments s on s.id=sl.shipment_id where sl.lot_id=l.id and s.status<>'cancelled');
 if n<>cardinality(p_lots) then raise exception 'Libere apenas prêmios de R$ 0, sem Pix ou envio ativo. Lotes com valor continuam exigindo pagamento.';end if;
 insert into public.external_prize_freight_releases(lot_id,customer_id,actor,reason) select id,customer_id,auth.uid(),btrim(p_reason) from public.lots where id=any(p_lots) on conflict(lot_id) do nothing;
 -- Registro sem cobrança: não grava paid_at nem cria pagamento ou pontos.
 update public.lots set status='paid' where id=any(p_lots) and status='pending_payment';
end; $$;
revoke all on function public.release_external_prize_freight(uuid,uuid[],text) from public,anon;
grant execute on function public.release_external_prize_freight(uuid,uuid[],text) to authenticated;

create or replace function public.get_due_freight_periods_before_checkout(p_customer uuid)
returns table(freight_period date,first_lot_id uuid,freight_amount numeric) language sql stable security definer set search_path='' as $$
 select l.auction_date-((extract(dow from l.auction_date)::integer-2+7)%7),l.id,20::numeric
 from public.lots l where l.customer_id=p_customer and l.status in('pending_payment','paid')
 and not (l.arremate_value=0 and exists(select 1 from public.external_prize_freight_releases r where r.lot_id=l.id and r.customer_id=p_customer))
 and not exists(select 1 from public.shipment_lots sl join public.shipments s on s.id=sl.shipment_id where sl.lot_id=l.id and s.status<>'cancelled')
 and not exists(select 1 from public.available_shipment_freight(p_customer))
 and not exists(select 1 from public.charges c where c.customer_id=p_customer and c.freight_amount>0 and c.status in('pending','in_process'))
 order by l.created_at,l.id limit 1;
$$;

create function public.is_external_prize_package(p_shipment uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.shipment_lots where shipment_id=p_shipment)
 and not exists(select 1 from public.shipment_lots sl join public.lots l on l.id=sl.lot_id join public.shipments s on s.id=sl.shipment_id
  where sl.shipment_id=p_shipment and (l.customer_id<>s.customer_id or l.arremate_value<>0 or l.status not in('paid','shipped','delivered')
   or not exists(select 1 from public.external_prize_freight_releases r where r.lot_id=l.id and r.customer_id=l.customer_id)))
 and not exists(select 1 from public.store_orders o join public.shipments s on s.id=p_shipment where o.customer_id=s.customer_id and o.payment_status='paid' and o.fulfillment_status<>'fulfilled'
  and (o.shipment_id is null or o.shipment_id=s.id) and o.created_at<((s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo') and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical'))
 and not exists(select 1 from public.logistics_pending l join public.shipments s on s.id=p_shipment where l.customer_id=s.customer_id and l.shipping_date<=s.batch_date and l.cancelled_at is null and (l.shipment_id is null or l.shipment_id=s.id))
 and not exists(select 1 from public.lots l join public.shipments s on s.id=p_shipment where l.customer_id=s.customer_id and l.status in('paid','pending_payment') and coalesce(l.shipping_date,s.batch_date)<=s.batch_date
  and not (l.arremate_value=0 and exists(select 1 from public.external_prize_freight_releases r where r.lot_id=l.id))
  and not exists(select 1 from public.shipment_lots sl join public.shipments active on active.id=sl.shipment_id where sl.lot_id=l.id and active.status<>'cancelled'));
$$;
revoke all on function public.is_external_prize_package(uuid) from public,anon,authenticated;
grant execute on function public.is_external_prize_package(uuid) to service_role;

alter function public.claim_shipment_freight(uuid) rename to claim_shipment_freight_before_external;
revoke all on function public.claim_shipment_freight_before_external(uuid) from public,anon,authenticated,service_role;
create function public.claim_shipment_freight(p_shipment uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype;
begin
 select * into s from public.shipments where id=p_shipment for update;
 if not found or s.status<>'pending' then raise exception 'Envio indisponível.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.customer_id::text,0));
 if public.is_external_prize_package(s.id) then update public.shipments set freight_payer='company' where id=s.id;
 else perform public.claim_shipment_freight_before_external(s.id);end if;
end; $$;
revoke all on function public.claim_shipment_freight(uuid) from public,anon,authenticated;
grant execute on function public.claim_shipment_freight(uuid) to service_role;
alter function public.assert_shipment_freight(uuid) rename to assert_shipment_freight_before_external;
revoke all on function public.assert_shipment_freight_before_external(uuid) from public,anon,authenticated,service_role;
create function public.assert_shipment_freight(p_shipment uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.shipments where id=p_shipment and freight_payer='company') and public.is_external_prize_package(p_shipment) then return;end if;
 perform public.assert_shipment_freight_before_external(p_shipment);
end; $$;
revoke all on function public.assert_shipment_freight(uuid) from public,anon,authenticated;
grant execute on function public.assert_shipment_freight(uuid) to service_role;
commit;
