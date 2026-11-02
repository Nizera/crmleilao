-- Release loja/rifas 02/11/2026. Aplicar uma vez, após 0044.
-- Não reaplica 0043, não abre compras, não cria cobrança nem zera dados.
begin;
-- 0045_store_checkout_email_guard.sql
-- Valida o Pix do frete antes de reservar moedas e estoque. Não abre a loja.
create or replace function public.checkout_store_cart_v2(p_request_key uuid,p_items jsonb,p_voucher uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();existing uuid;physical boolean;quote jsonb;fee numeric:=0;expected numeric;o public.store_orders%rowtype;
begin
 if customer is null or p_request_key is null then raise exception 'Cliente não autenticado.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(customer::text,0));
 select id into existing from public.store_orders where customer_id=customer and request_key=p_request_key;if found then return existing;end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Carrinho inválido.';end if;
 select exists(select 1 from jsonb_to_recordset(p_items)x(reward_id uuid) join public.loyalty_rewards r on r.id=x.reward_id where r.delivery_kind='physical') into physical;
 if physical then
  quote:=public.store_freight_quote_for(customer);
  if quote->>'status'='awaiting' then raise exception 'O frete já está em um Pix pendente ou em análise. Confira esse pagamento antes de comprar.';end if;
  fee:=(quote->>'amount')::numeric;
 end if;
 expected:=(p_items->0->>'expected_freight_amount')::numeric;
 if expected is null or expected not in(0,20) or expected<>fee then raise exception 'O frete mudou. Confira o total atualizado e confirme novamente.';end if;
 if fee>0 and not exists(select 1 from public.customers where id=customer and nullif(btrim(email),'') is not null) then
  raise exception 'Preencha seu e-mail em Meus dados antes de pagar por Pix.';
 end if;
 existing:=public.checkout_store_cart_before_freight(p_request_key,p_items,p_voucher);
 select * into o from public.store_orders where id=existing for update;
 if fee>0 then
  -- Vouchers descontam só produtos; moedas podem pagar produtos, nunca o frete.
  update public.store_orders set freight_amount=fee,cash_total=cash_total+fee,payment_status='creating',paid_at=null,updated_at=now() where id=o.id;
  update public.customer_store_vouchers set status='reserved' where id=o.voucher_id and order_id=o.id;
 end if;
 return existing;
end $$;
revoke all on function public.checkout_store_cart_v2(uuid,jsonb,uuid) from public,anon;
grant execute on function public.checkout_store_cart_v2(uuid,jsonb,uuid) to authenticated;
-- 0046_shipment_content_snapshot.sql
-- Conteúdo declarado e conteúdo vinculado devem ser o mesmo conjunto.
-- Não altera valores de arremates, saldos, moedas ou liberação de compras.
alter table public.logistics_pending add column shipping_declared_value numeric(12,2) not null default 0 check(shipping_declared_value between 0 and 100000);
alter table public.shipments add column content_snapshot jsonb;

-- Uma etiqueta criada ainda não significa prêmio despachado. Estorno bloqueia
-- a separação mesmo com vínculo; cancelar a etiqueta não reativa o prêmio.
create or replace function public.release_logistics_on_cancel() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='cancelled' and old.status is distinct from new.status then
  update public.logistics_pending l set shipment_id=null,
   cancelled_at=case when l.source_kind='raffle' and not exists(
    select 1 from public.raffle_awards a join public.raffle_orders o on o.id=a.order_id
    where a.logistics_id=l.id and o.status='paid') then coalesce(l.cancelled_at,now()) else l.cancelled_at end
  where l.shipment_id=new.id;
 end if;
 return new;
end; $$;
revoke all on function public.release_logistics_on_cancel() from public,anon,authenticated;

create function public.assert_shipment_raffle_payments(p_shipment uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.logistics_pending l
  left join public.raffle_awards a on a.logistics_id=l.id
  left join public.raffle_orders o on o.id=a.order_id
  where l.shipment_id=p_shipment and l.source_kind='raffle'
   and (l.cancelled_at is not null or o.status is distinct from 'paid')) then
  raise exception 'Há prêmio com pagamento em análise neste pacote. Cancele a etiqueta e confira a rifa antes de enviar.';
 end if;
end; $$;
revoke all on function public.assert_shipment_raffle_payments(uuid) from public,anon,authenticated;
grant execute on function public.assert_shipment_raffle_payments(uuid) to service_role;

create function public.box_raffle_award(p_issue uuid,p_value numeric) returns void
language plpgsql security definer set search_path='' as $$
declare customer uuid; issue public.logistics_pending%rowtype;
begin
 if not public.has_staff_write() then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_value is null or p_value<=0 or p_value>100000 or p_value<>round(p_value,2) then raise exception 'Informe o valor declarado do prêmio em reais.'; end if;
 select customer_id into customer from public.logistics_pending where id=p_issue;
 if customer is null then raise exception 'Prêmio não encontrado.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(customer::text,0));
 select * into issue from public.logistics_pending where id=p_issue for update;
 if issue.source_kind<>'raffle' or issue.cancelled_at is not null or issue.shipment_id is not null then raise exception 'Prêmio indisponível para separação.'; end if;
 if not exists(select 1 from public.raffle_awards a join public.raffle_orders o on o.id=a.order_id where a.logistics_id=p_issue and o.status='paid') then raise exception 'Confira o pagamento do prêmio antes da separação.'; end if;
 if issue.moved_at is not null and issue.shipping_declared_value>0 then return; end if;
 update public.logistics_pending set shipping_declared_value=p_value,moved_at=coalesce(moved_at,now()),moved_by=auth.uid() where id=p_issue;
end; $$;
revoke all on function public.box_raffle_award(uuid,numeric) from public,anon;
grant execute on function public.box_raffle_award(uuid,numeric) to authenticated;

create function public.require_raffle_box_value() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.source_kind='raffle' and new.moved_at is not null and new.shipping_declared_value<=0
  and (new.shipment_id is not null or new.moved_at is distinct from old.moved_at or new.shipping_declared_value is distinct from old.shipping_declared_value) then raise exception 'Confira o valor declarado do prêmio antes de colocar na caixa.'; end if;
 if new.source_kind='raffle' and new.cancelled_at is null and (new.moved_at is not null or new.shipment_id is not null)
  and not exists(select 1 from public.raffle_awards a join public.raffle_orders o on o.id=a.order_id where a.logistics_id=new.id and o.status='paid') then raise exception 'Confira o pagamento do prêmio antes de enviar.'; end if;
 return new;
end; $$;
create trigger raffle_box_value before update of moved_at,shipping_declared_value,shipment_id on public.logistics_pending for each row execute function public.require_raffle_box_value();
revoke all on function public.require_raffle_box_value() from public,anon,authenticated,service_role;

create function public.bind_shipment_contents(p_shipment uuid,p_expected jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype; actual jsonb; canonical jsonb; declared numeric; n integer;
begin
 select * into s from public.shipments where id=p_shipment for update;
 if not found or s.status<>'pending' then raise exception 'Envio indisponível.'; end if;
 if jsonb_typeof(p_expected->'store') is distinct from 'array' or jsonb_typeof(p_expected->'logistics') is distinct from 'array' or jsonb_typeof(p_expected->'lots') is distinct from 'array' then raise exception 'Conteúdo do pacote inválido.'; end if;
 if jsonb_array_length(p_expected->'store')>500 or jsonb_array_length(p_expected->'logistics')>500 or jsonb_array_length(p_expected->'lots')>500 then raise exception 'Limite de itens do pacote excedido.'; end if;
 select jsonb_build_object('store',coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(p_expected->'store') x),'[]'::jsonb),
 'logistics',coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(p_expected->'logistics') x),'[]'::jsonb),
 'lots',coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(p_expected->'lots') x),'[]'::jsonb)) into canonical;
 if s.content_snapshot is not null then
  if s.content_snapshot<>canonical then raise exception 'O conteúdo desta etiqueta já foi definido.'; end if;
  return 0;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.customer_id::text,0));
 -- Trava também pedidos ainda não pagos: eles não podem virar outro item
 -- elegível/na caixa entre a comparação e o vínculo.
 perform id from public.store_orders where customer_id=s.customer_id and created_at<((s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo') order by id for update;
 perform id from public.logistics_pending where customer_id=s.customer_id and shipping_date<=s.batch_date order by id for update;
 perform l.id from public.lots l join public.shipment_lots sl on sl.lot_id=l.id where sl.shipment_id=s.id order by l.id for update of l;
 select jsonb_build_object(
 'store',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'value',o.shipping_declared_value) order by o.id) from public.store_orders o where o.customer_id=s.customer_id and o.payment_status='paid' and o.fulfillment_status<>'fulfilled' and o.shipment_id is null and o.created_at<((s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo') and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical')),'[]'::jsonb),
 'logistics',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'value',p.shipping_declared_value) order by p.id) from public.logistics_pending p where p.customer_id=s.customer_id and p.shipping_date<=s.batch_date and p.shipment_id is null and p.cancelled_at is null),'[]'::jsonb),
 'lots',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'value',l.arremate_value) order by l.id) from public.shipment_lots sl join public.lots l on l.id=sl.lot_id where sl.shipment_id=s.id and l.customer_id=s.customer_id and l.status='paid'),'[]'::jsonb)) into actual;
 if actual<>canonical then raise exception 'O conteúdo do pacote mudou durante a emissão. Atualize a separação e emita novamente.'; end if;
 if exists(select 1 from public.logistics_pending where customer_id=s.customer_id and shipping_date<=s.batch_date and shipment_id is null and cancelled_at is null and source_kind='raffle' and (moved_at is null or shipping_declared_value<=0)) then raise exception 'Confira a separação e o valor declarado dos prêmios.'; end if;
 select coalesce(sum((x->>'value')::numeric),0) into declared from jsonb_array_elements((actual->'store')||(actual->'logistics')||(actual->'lots')) x;
 if s.insurance_value>0 and round(s.insurance_value,2)<>round(declared,2) then raise exception 'O seguro não corresponde ao conteúdo declarado.'; end if;
 n:=public.bind_store_orders_to_shipment(s.id);
 perform public.assert_shipment_raffle_payments(s.id);
 -- Defesa adicional contra qualquer camada de vínculo que acrescente itens.
 select jsonb_build_object(
 'store',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'value',o.shipping_declared_value) order by o.id) from public.store_orders o where o.shipment_id=s.id),'[]'::jsonb),
 'logistics',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'value',p.shipping_declared_value) order by p.id) from public.logistics_pending p where p.shipment_id=s.id),'[]'::jsonb),
 'lots',actual->'lots') into actual;
 if actual<>canonical then raise exception 'O conteúdo vinculado diverge da declaração. Emita novamente.'; end if;
 update public.shipments set content_snapshot=canonical where id=s.id;
 return n;
end; $$;
revoke all on function public.bind_shipment_contents(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.bind_shipment_contents(uuid,jsonb) to service_role;
-- 0047_raffle_review_resolution.sql
create index raffle_awards_customer_page on public.raffle_awards(customer_id,created_at desc,id);
create index raffle_awards_order on public.raffle_awards(order_id);

create function public.prevent_sales_after_raffle_result() returns trigger
language plpgsql security definer set search_path='' as $$
declare campaign uuid;
begin
 if tg_table_name='raffle_campaigns' then
  if new.status<>'open' then return new; end if;
  campaign:=new.id;
 else campaign:=new.campaign_id;
 end if;
 if exists(select 1 from public.raffle_awards a join public.raffle_prizes p on p.id=a.prize_id where a.campaign_id=campaign and p.kind='main') then
  raise exception 'O resultado principal já foi registrado. Novas vendas não podem ser abertas.';
 end if;
 return new;
end; $$;
create trigger raffle_no_reopen_after_result before update of status on public.raffle_campaigns for each row execute function public.prevent_sales_after_raffle_result();
create trigger raffle_no_reserve_after_result before insert on public.raffle_orders for each row execute function public.prevent_sales_after_raffle_result();
revoke all on function public.prevent_sales_after_raffle_result() from public,anon,authenticated,service_role;

-- O navegador não fornece prova de estorno. Só o serviço pode chamar após
-- reconsultar o provedor. Não executa reembolso nem reconhece estorno parcial.
create function public.resolve_refunded_raffle(p_order uuid,p_mp_id text,p_reference text,p_amount numeric,p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.raffle_orders%rowtype; cid uuid;
begin
 if not exists(select 1 from public.admin_profiles where id=p_actor and role in('owner','staff')) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 select campaign_id into cid from public.raffle_orders where id=p_order;
 perform 1 from public.raffle_campaigns where id=cid for update;
 select * into o from public.raffle_orders where id=p_order for update;
 if not found or o.mp_order_id is distinct from p_mp_id or o.external_reference is distinct from p_reference or o.amount is distinct from p_amount then raise exception 'Pagamento divergente.'; end if;
 if o.status='cancelled' then return; end if;
 if o.status<>'review' then raise exception 'Esta reserva não está em análise.'; end if;
 if exists(select 1 from public.raffle_awards a join public.raffle_prizes p on p.id=a.prize_id left join public.logistics_pending l on l.id=a.logistics_id where a.order_id=o.id and (p.kind='main' or l.shipment_id is not null)) then
  raise exception 'Cancele a etiqueta antes de resolver. Prêmio principal já apurado exige análise manual da campanha.';
 end if;
 update public.logistics_pending set cancelled_at=coalesce(cancelled_at,now()) where id in(select logistics_id from public.raffle_awards where order_id=o.id) and shipment_id is null;
 update public.raffle_orders set status='cancelled',checked_at=now() where id=o.id;
 -- Prêmios instantâneos já revelados permanecem retidos, com seu histórico.
 -- As demais cotas voltam à venda; nenhuma cota de outro pedido é alterada.
 delete from public.raffle_allocations a where a.order_id=o.id and not exists(select 1 from public.raffle_awards w where w.order_id=o.id and w.number=a.number);
 insert into public.raffle_events(campaign_id,actor,action) values(cid,p_actor,'Estorno integral conferido: '||o.code||'. Prêmios revelados retidos; demais cotas liberadas.');
end; $$;
revoke all on function public.resolve_refunded_raffle(uuid,text,text,numeric,uuid) from public,anon,authenticated;
grant execute on function public.resolve_refunded_raffle(uuid,text,text,numeric,uuid) to service_role;
create or replace function public.get_raffle_awards(p_page integer default 1,p_orders uuid[] default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_customer_id() is null and not public.is_admin() then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_orders is not null and cardinality(p_orders)>10 then raise exception 'Limite de pedidos por consulta.'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select a.id,a.campaign_id,a.order_id,a.customer_id,a.number,a.logistics_id,p.title,p.kind,c.title campaign_title,c.total_numbers,cu.name customer_name,l.moved_at,l.shipment_id,l.cancelled_at,o.status order_status,s.tracking_code,s.status shipment_status
 from public.raffle_awards a join public.raffle_orders o on o.id=a.order_id join public.customers cu on cu.id=a.customer_id join public.raffle_prizes p on p.id=a.prize_id join public.raffle_campaigns c on c.id=a.campaign_id join public.logistics_pending l on l.id=a.logistics_id left join public.shipments s on s.id=l.shipment_id
 where (public.is_admin() or a.customer_id=public.current_customer_id()) and (p_orders is null or a.order_id=any(p_orders))
 order by a.created_at desc,a.id limit (case when p_orders is null then 20 else 2000 end) offset (case when p_orders is null then (greatest(1,least(coalesce(p_page,1),10000))-1)*20 else 0 end)) x);
end; $$;
-- 0048_raffle_prize_shipping.sql
alter table public.shipments add column freight_payer text not null default 'customer' check(freight_payer in('customer','company'));

-- Benefício exclusivo de pacote composto apenas por prêmios pagos de rifa.
-- Não consome créditos de frete do cliente e não isenta compras ou lotes.
create function public.raffle_only_package(p_customer uuid,p_day date,p_shipment uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select p_customer is not null and p_day is not null
 and not exists(select 1 from public.shipment_lots where shipment_id=p_shipment)
 and not exists(select 1 from public.lots l where l.customer_id=p_customer and l.status='paid' and coalesce(l.shipping_date,p_day)<=p_day
  and not exists(select 1 from public.shipment_lots sl join public.shipments s on s.id=sl.shipment_id where sl.lot_id=l.id and s.status<>'cancelled'))
 and not exists(select 1 from public.store_orders o where o.customer_id=p_customer and o.payment_status='paid' and o.fulfillment_status<>'fulfilled'
  and (o.shipment_id is null or o.shipment_id=p_shipment) and o.created_at<((p_day+1)::timestamp at time zone 'America/Sao_Paulo')
  and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical'))
 and exists(select 1 from public.logistics_pending l where l.customer_id=p_customer and l.shipping_date<=p_day and l.cancelled_at is null and (l.shipment_id is null or l.shipment_id=p_shipment))
 and not exists(select 1 from public.logistics_pending l left join public.raffle_awards a on a.logistics_id=l.id left join public.raffle_orders o on o.id=a.order_id
  where l.customer_id=p_customer and l.shipping_date<=p_day and l.cancelled_at is null and (l.shipment_id is null or l.shipment_id=p_shipment)
  and (l.source_kind<>'raffle' or l.moved_at is null or l.shipping_declared_value<=0 or o.status is distinct from 'paid'));
$$;
revoke all on function public.raffle_only_package(uuid,date,uuid) from public,anon,authenticated;
grant execute on function public.raffle_only_package(uuid,date,uuid) to service_role;

alter function public.claim_shipment_freight(uuid) rename to claim_shipment_freight_before_prize;
revoke all on function public.claim_shipment_freight_before_prize(uuid) from public,anon,authenticated,service_role;
create function public.claim_shipment_freight(p_shipment uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype;
begin
 select * into s from public.shipments where id=p_shipment for update;
 if not found or s.status<>'pending' then raise exception 'Envio indisponível.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.customer_id::text,0));
 if public.raffle_only_package(s.customer_id,s.batch_date,s.id) then
  update public.shipments set freight_payer='company' where id=s.id;
 else
  perform public.claim_shipment_freight_before_prize(s.id);
  update public.shipments set freight_payer='customer' where id=s.id;
 end if;
end; $$;
revoke all on function public.claim_shipment_freight(uuid) from public,anon,authenticated;
grant execute on function public.claim_shipment_freight(uuid) to service_role;

alter function public.assert_shipment_freight(uuid) rename to assert_shipment_freight_before_prize;
revoke all on function public.assert_shipment_freight_before_prize(uuid) from public,anon,authenticated,service_role;
create function public.assert_shipment_freight(p_shipment uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype;
begin
 select * into s from public.shipments where id=p_shipment;
 if s.freight_payer='company' then
  -- Usa somente o conteúdo congelado no envio. Novas compras não modificam
  -- retroativamente o pacote, mas nenhum item pago pode entrar como prêmio.
  if s.content_snapshot is null or jsonb_array_length(s.content_snapshot->'lots')<>0 or jsonb_array_length(s.content_snapshot->'store')<>0
   or exists(select 1 from public.shipment_lots where shipment_id=s.id)
   or exists(select 1 from public.store_orders where shipment_id=s.id)
   or not exists(select 1 from public.logistics_pending where shipment_id=s.id and source_kind='raffle')
   or exists(select 1 from public.logistics_pending l left join public.raffle_awards a on a.logistics_id=l.id left join public.raffle_orders o on o.id=a.order_id
    where l.shipment_id=s.id and (l.source_kind<>'raffle' or l.cancelled_at is not null or l.moved_at is null or l.shipping_declared_value<=0 or o.status is distinct from 'paid')) then raise exception 'Confira o conteúdo e o pagamento dos prêmios antes de pagar a etiqueta por conta da empresa.'; end if;
  return;
 end if;
 perform public.assert_shipment_freight_before_prize(p_shipment);
end; $$;
revoke all on function public.assert_shipment_freight(uuid) from public,anon,authenticated;
grant execute on function public.assert_shipment_freight(uuid) to service_role;
create or replace function public.bind_store_orders_to_shipment_base(p_shipment uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype;n integer;
begin
 select * into s from public.shipments where id=p_shipment for update;
 if not found or s.status<>'pending' then raise exception 'Envio indisponível.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.customer_id::text,0));
 perform public.assert_customer_shipping_ready(s.customer_id);
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
commit;
