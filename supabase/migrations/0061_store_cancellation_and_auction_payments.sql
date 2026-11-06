-- Isola pagamentos do leilão e torna o cancelamento da loja recuperável.
begin;
alter table public.store_orders add column if not exists pix_creation_started_at timestamptz;
alter table public.store_orders add column if not exists cancellation_requested_at timestamptz;
alter table public.store_orders add column if not exists pix_creation_managed boolean not null default false;
-- Reservas antigas sem ID podem ter uma criação remota que perdeu a resposta.
-- Não presumir que é seguro liberar esses recursos sem consultar o provedor.
update public.store_orders set pix_creation_started_at=created_at
where pix_creation_started_at is null and cash_total>0 and payment_status in('creating','pending');

-- Só o checkout novo comprova que a criação do Pix passa pelo protocolo abaixo.
-- Chamadas da versão anterior/local pilot permanecem conservadoras, inclusive no rollout.
create or replace function public.checkout_store_cart_cancellable(p_request_key uuid,p_items jsonb,p_voucher uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();existing uuid;created uuid;
begin
 if customer is null then raise exception 'Cliente não autenticado.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(customer::text,0));
 select id into existing from public.store_orders where customer_id=customer and request_key=p_request_key;
 created:=public.checkout_store_cart_v2(p_request_key,p_items,p_voucher);
 if existing is null then update public.store_orders set pix_creation_managed=true where id=created and customer_id=customer;end if;
 return created;
end $$;
revoke all on function public.checkout_store_cart_cancellable(uuid,jsonb,uuid) from public,anon;
grant execute on function public.checkout_store_cart_cancellable(uuid,jsonb,uuid) to authenticated;

create or replace function public.claim_store_pix_creation(p_order uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare o public.store_orders%rowtype;
begin
 select * into o from public.store_orders where id=p_order for update;
 if not found or o.payment_status not in('creating','pending') or o.cash_total<=0 or o.mp_order_id is not null then return false;end if;
 if o.cancellation_requested_at is not null and o.pix_creation_managed and o.pix_creation_started_at is null then return false;end if;
 update public.store_orders set pix_creation_started_at=coalesce(pix_creation_started_at,now()) where id=o.id;
 return true;
end $$;
revoke all on function public.claim_store_pix_creation(uuid) from public,anon,authenticated;
grant execute on function public.claim_store_pix_creation(uuid) to service_role;

create or replace function public.request_store_order_cancellation(p_order uuid,p_customer uuid) returns text
language plpgsql security definer set search_path='' as $$
declare o public.store_orders%rowtype;
begin
 select * into o from public.store_orders where id=p_order and customer_id=p_customer for update;
 if not found then raise exception 'Pedido não encontrado.';end if;
 if o.payment_status not in('creating','pending') then return o.payment_status;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(o.customer_id::text,0));
 update public.store_orders set cancellation_requested_at=coalesce(cancellation_requested_at,now()),updated_at=now() where id=o.id;
 -- Só libera localmente quando nenhuma tentativa de criar o Pix começou.
 if o.mp_order_id is null and o.pix_creation_managed and o.pix_creation_started_at is null then
  if o.resources_released_at is null then
   if o.coins_total>0 then
    insert into public.loyalty_ledger(customer_id,points,kind,store_order_id,note)
    values(o.customer_id,o.coins_total,'adjustment',o.id,'Caracoins devolvidas · cancelamento antes do Pix · '||o.code);
   end if;
   perform r.id from public.loyalty_rewards r join public.store_order_items i on i.reward_id=r.id where i.order_id=o.id order by r.id for update of r;
   update public.loyalty_rewards r set stock=r.stock+x.quantity from(
    select reward_id,sum(quantity)::integer quantity from public.store_order_items where order_id=o.id and reserved_stock group by reward_id
   )x where r.id=x.reward_id and r.stock is not null;
  end if;
  update public.store_orders set payment_status='cancelled',resources_released_at=coalesce(resources_released_at,now()),reconciliation_error=null,updated_at=now() where id=o.id;
  return 'cancelled';
 end if;
 return o.payment_status;
end $$;
revoke all on function public.request_store_order_cancellation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.request_store_order_cancellation(uuid,uuid) to service_role;

-- O frete continua reservado na loja, mas isso não impede pagar só os lotes.
-- Se o pedido da loja for cancelado, o frete volta a ser devido no próximo Pix.
create or replace function public.require_lot_period_freight() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.charge_id is null or new.charge_id is not distinct from old.charge_id then return new;end if;
 if not exists(select 1 from public.available_shipment_freight(new.customer_id))
 and not exists(select 1 from public.available_store_freight(new.customer_id))
 and not exists(select 1 from public.charge_freight_items where customer_id=new.customer_id and charge_id=new.charge_id and status in('pending','in_process','approved'))
 and not exists(select 1 from public.store_orders where customer_id=new.customer_id and freight_amount>0 and payment_status in('creating','pending','partially_refunded','payment_review'))
 then raise exception 'O frete de R$20 do envio acumulado deve acompanhar o pagamento dos lotes.';end if;
 return new;
end $$;
commit;
