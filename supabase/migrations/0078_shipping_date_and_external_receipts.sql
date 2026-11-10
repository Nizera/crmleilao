-- Conferência financeira pela data do pacote e confirmação de frete recebido por fora.
begin;
create or replace function public.assert_customer_shipping_ready_for_date(p_customer uuid,p_day date) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_customer is null or p_day is null then raise exception 'Informe cliente e data do envio.';end if;
 if exists(select 1 from public.lots where customer_id=p_customer and status='pending_payment' and coalesce(shipping_date,p_day)=p_day) then raise exception 'Não é possível emitir: há lotes pendentes de pagamento para esta data de envio.';end if;
 if exists(select 1 from public.charges c where c.customer_id=p_customer and c.status in('pending','in_process') and (c.freight_amount>0 and c.freight_period=p_day-((extract(dow from p_day)::int-2+7)%7) or exists(select 1 from public.lots l where l.charge_id=c.id and coalesce(l.shipping_date,p_day)=p_day))) then raise exception 'Não é possível emitir: há um Pix pendente referente a esta data de envio.';end if;
 if exists(select 1 from public.lots where customer_id=p_customer and status in('paid','pending_payment') and coalesce(shipping_date,p_day)=p_day)
 and exists(select 1 from public.get_due_freight_periods(p_customer)) then raise exception 'Não é possível emitir: há frete pendente para este envio.';end if;
end $$;
revoke all on function public.assert_customer_shipping_ready_for_date(uuid,date) from public,anon,authenticated;
grant execute on function public.assert_customer_shipping_ready_for_date(uuid,date) to service_role;

create or replace function public.record_external_freight_payment(p_customer uuid,p_day date,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare receipt uuid; ref text;
begin
 if not public.has_staff_write() then raise exception 'Acesso negado.' using errcode='42501';end if;
 if p_day is null or p_reason is null or char_length(trim(p_reason)) not between 5 and 350 then raise exception 'Informe a data e o motivo da confirmação.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text,0));
 if not exists(select 1 from public.customers where id=p_customer) then raise exception 'Cliente não encontrado.';end if;
 ref:='manual_freight_'||p_customer::text||'_'||p_day::text;
 select id into receipt from public.charges where external_reference=ref and status='approved';if found then return receipt;end if;
 select charge_id into receipt from public.available_shipment_freight(p_customer) limit 1;if found then return receipt;end if;
 if exists(select 1 from public.charges where customer_id=p_customer and freight_amount>0 and status in('pending','in_process') and freight_period=p_day-((extract(dow from p_day)::int-2+7)%7)) then raise exception 'Há um Pix de frete em aberto para este envio. Confira ou cancele antes de registrar recebimento por fora.';end if;
 insert into public.charges(customer_id,amount,freight_amount,freight_period,status,external_reference,description,created_by,paid_at)
 values(p_customer,20,20,p_day-((extract(dow from p_day)::int-2+7)%7),'approved',ref,'Frete pago por fora: '||trim(p_reason),auth.uid(),null) returning id into receipt;
 return receipt;
end $$;
revoke all on function public.record_external_freight_payment(uuid,date,text) from public,anon;
grant execute on function public.record_external_freight_payment(uuid,date,text) to authenticated;

create or replace function public.bind_store_orders_to_shipment_base(p_shipment uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype;n integer;
begin
 select * into s from public.shipments where id=p_shipment for update;
 if not found or s.status<>'pending' then raise exception 'Envio indisponível.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.customer_id::text,0));
 perform public.assert_customer_shipping_ready_for_date(s.customer_id,s.batch_date);
 perform public.assert_store_shipping_ready(s.customer_id,s.batch_date);
 perform o.id from public.store_orders o where o.customer_id=s.customer_id and o.payment_status='paid' and o.fulfillment_status<>'fulfilled' and o.shipment_id is null
 and o.created_at<((s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo') order by o.id for update;
 if exists(select 1 from public.store_orders o where o.customer_id=s.customer_id and o.payment_status='paid' and o.fulfillment_status<>'fulfilled' and o.shipment_id is null and o.boxed_at is not null
 and o.created_at<((s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo') and o.shipping_declared_value is null
 and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical')) then raise exception 'Confira o valor declarado dos pedidos da loja.';end if;
 update public.store_orders o set shipment_id=s.id,updated_at=now() where o.customer_id=s.customer_id and o.payment_status='paid'
 and o.fulfillment_status<>'fulfilled' and o.boxed_at is not null and o.shipment_id is null and o.created_at<((s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo')
 and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical');
 get diagnostics n=row_count;
 if n=0 and not exists(select 1 from public.shipment_lots sl join public.lots l on l.id=sl.lot_id where sl.shipment_id=s.id and l.customer_id=s.customer_id and l.status='paid') and not public.raffle_only_package(s.customer_id,s.batch_date,s.id) then raise exception 'Nenhum lote, produto ou prêmio elegível disponível para envio.';end if;
 return n;
end $$;
create or replace function public.validate_shipment_draft(p_customer uuid,p_day date,p_expected jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare actual jsonb; canonical jsonb;
begin
 if p_customer is null or p_day is null then raise exception 'Informe cliente e data do envio.';end if;
 if jsonb_typeof(p_expected->'lots') is distinct from 'array' or jsonb_typeof(p_expected->'store') is distinct from 'array' or jsonb_typeof(p_expected->'logistics') is distinct from 'array' then raise exception 'Conteúdo do pacote inválido.';end if;
 if jsonb_array_length(p_expected->'lots')>500 or jsonb_array_length(p_expected->'store')>500 or jsonb_array_length(p_expected->'logistics')>500 then raise exception 'Limite de itens excedido.';end if;
 perform public.assert_customer_shipping_ready_for_date(p_customer,p_day);
 perform public.assert_store_shipping_ready(p_customer,p_day);
 select jsonb_build_object(
 'lots',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'value',l.arremate_value) order by l.id) from public.lots l where l.customer_id=p_customer and l.status='paid' and l.id in(select (x->>'id')::uuid from jsonb_array_elements(p_expected->'lots') x) and not exists(select 1 from public.shipment_lots sl join public.shipments s on s.id=sl.shipment_id where sl.lot_id=l.id and s.status<>'cancelled')),'[]'::jsonb),
 'store',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'value',o.shipping_declared_value) order by o.id) from public.store_orders o where o.customer_id=p_customer and o.payment_status='paid' and o.fulfillment_status<>'fulfilled' and o.shipment_id is null and o.created_at<((p_day+1)::timestamp at time zone 'America/Sao_Paulo') and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical')),'[]'::jsonb),
 'logistics',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'value',p.shipping_declared_value) order by p.id) from public.logistics_pending p where p.customer_id=p_customer and p.shipping_date<=p_day and p.shipment_id is null and p.cancelled_at is null),'[]'::jsonb)) into actual;
 select jsonb_build_object('lots',coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(p_expected->'lots') x),'[]'::jsonb),'store',coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(p_expected->'store') x),'[]'::jsonb),'logistics',coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(p_expected->'logistics') x),'[]'::jsonb)) into canonical;
 if actual<>canonical then raise exception 'O conteúdo do pacote mudou. Atualize a tela antes de emitir.';end if;
 if exists(select 1 from public.logistics_pending p left join public.raffle_awards a on a.logistics_id=p.id left join public.raffle_orders o on o.id=a.order_id where p.customer_id=p_customer and p.shipping_date<=p_day and p.shipment_id is null and p.cancelled_at is null and p.source_kind='raffle' and o.status is distinct from 'paid') then raise exception 'Há prêmio com pagamento em análise. Confira antes de emitir.';end if;
end $$;
commit;
