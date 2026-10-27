-- Complementa a fixture base com as fronteiras usadas pelas migrations 0026–0031.
-- As regras da loja continuam vindo dos SQL reais, não de réplicas nos testes.
create or replace function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('test.actor',true),'')::uuid;
$$;
alter table public.customers add column auth_user_id uuid;
alter table public.lots add column code text,add column title text,add column customer_id uuid,
 add column status text default 'paid',add column shipping_date date;
alter table public.loyalty_ledger add column created_at timestamptz default now(),
 add column lot_value numeric,add column earn_rate numeric,add column created_by uuid;
alter table public.loyalty_redemptions
 add column customer_id uuid,add column reward_id uuid,add column reward_name text,
 add column points_cost integer,add column created_at timestamptz default now(),
 add column admin_note text,add column customer_note text;
create table public.shipments(id uuid primary key default gen_random_uuid(),customer_id uuid not null,
 batch_date date not null,status text not null default 'pending',code text default 'E-TEST',tracking_code text);
create table public.shipment_lots(shipment_id uuid references public.shipments(id),lot_id uuid references public.lots(id),primary key(shipment_id,lot_id));
-- Não substitui o teste do frete: permite simular o bloqueio de prontidão no limite do módulo.
create function public.assert_customer_shipping_ready(p_customer uuid) returns void language plpgsql as $$
begin
 if current_setting('test.freight_unpaid',true)='true' or exists(select 1 from public.lots where customer_id=p_customer and status='pending_payment') then
  raise exception 'Frete ou lote pendente.';
 end if;
end; $$;
