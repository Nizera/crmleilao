-- Repara bancos onde o motor privado não foi criado pela migration 0033.
-- Não altera pedidos existentes, preços, saldos ou a configuração de abertura.
begin;
create or replace function public.checkout_store_cart_live(p_request_key uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := public.current_customer_id();
  v_order uuid; v_reward public.loyalty_rewards%rowtype; v_line record;
  v_cash numeric(12,2) := 0; v_coins numeric(12,2) := 0;
  v_unit_cash numeric(12,2); v_unit_coins numeric(12,2); v_balance numeric(12,2);
begin
  if v_customer is null or p_request_key is null then raise exception 'Cliente não autenticado.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'O carrinho deve conter de 1 a 50 produtos.';
  end if;
  -- Mesmo bloqueio das correções de saldo e dos resgates legados.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_customer::text,0));
  select id into v_order from public.store_orders where customer_id = v_customer and request_key = p_request_key;
  if found then return v_order; end if;
  if not exists(select 1 from public.store_commerce_settings where id and purchases_enabled) then raise exception 'A loja está em prévia.';end if;
  if exists (select 1 from public.store_orders where customer_id = v_customer and payment_status in ('creating','pending')) then
    raise exception 'Você já tem um pedido aguardando Pix. Pague ou cancele antes de criar outro.';
  end if;
  perform 1 from public.loyalty_settings where id = true and active for share;
  if not found then raise exception 'A loja está indisponível no momento.'; end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(reward_id uuid, quantity integer, mode text)
    where reward_id is null or quantity is null or quantity not between 1 and 99
      or mode is null or mode not in ('coins','cash')) then raise exception 'Carrinho inválido.'; end if;
  if (select count(*) from (select distinct x.reward_id,x.mode from jsonb_to_recordset(p_items)
    as x(reward_id uuid, mode text)) d) <> jsonb_array_length(p_items) then raise exception 'Produto duplicado no carrinho.'; end if;
  if (select count(distinct x.mode) from jsonb_to_recordset(p_items) x(mode text))<>1 then raise exception 'Separe compras em reais e resgates em Caracoins.';end if;
  -- Ordenação fixa evita deadlocks entre compras de produtos em ordens diferentes.
  perform r.id from public.loyalty_rewards r where r.id in (
    select x.reward_id from jsonb_to_recordset(p_items) as x(reward_id uuid)
  ) order by r.id for update;
  v_order := gen_random_uuid();
  insert into public.store_orders(id,customer_id,request_key,external_reference,cash_total,coins_total,payment_status)
  values (v_order,v_customer,p_request_key,'shop_' || v_order,0,1,'creating');
  for v_line in select * from jsonb_to_recordset(p_items) as x(reward_id uuid,quantity integer,mode text,expected_cash numeric,expected_coins numeric)
  loop
    select * into v_reward from public.loyalty_rewards where id = v_line.reward_id and active;
    if not found then raise exception 'Um produto não está mais disponível.'; end if;
    v_unit_cash := case v_line.mode when 'cash' then v_reward.cash_price when 'mixed' then v_reward.mixed_cash_price else 0 end;
    v_unit_coins := case v_line.mode when 'coins' then v_reward.points_cost when 'mixed' then v_reward.mixed_points_cost else 0 end;
    if v_unit_cash is null or v_unit_coins is null or v_unit_cash + v_unit_coins <= 0 then
      raise exception 'Modalidade de pagamento indisponível para %.',v_reward.name;
    end if;
    if v_line.expected_cash is distinct from v_unit_cash or v_line.expected_coins is distinct from v_unit_coins then
      raise exception 'O preço de % mudou. Atualize a loja antes de comprar.',v_reward.name;
    end if;
    if v_reward.stock is not null and v_reward.stock < v_line.quantity then raise exception 'Estoque insuficiente: %.',v_reward.name; end if;
    insert into public.store_order_items(order_id,reward_id,name,image_path,quantity,price_mode,unit_cash,unit_coins,reserved_stock)
    values (v_order,v_reward.id,v_reward.name,v_reward.image_path,v_line.quantity,v_line.mode,v_unit_cash,v_unit_coins,v_reward.stock is not null);
    if v_reward.stock is not null then update public.loyalty_rewards set stock = stock - v_line.quantity where id = v_reward.id; end if;
    v_cash := v_cash + v_unit_cash * v_line.quantity;
    v_coins := v_coins + v_unit_coins * v_line.quantity;
  end loop;
  select coalesce(sum(points),0) into v_balance from public.loyalty_ledger where customer_id = v_customer;
  if v_coins > 0 and v_coins > v_balance then raise exception 'Saldo de Caracoins insuficiente.'; end if;
  if v_cash > 0 and not exists (select 1 from public.customers where id = v_customer and nullif(trim(email),'') is not null) then
    raise exception 'Preencha seu e-mail em Meus dados antes de pagar por Pix.';
  end if;
  update public.store_orders set cash_total = v_cash, coins_total = v_coins,
    payment_status = case when v_cash = 0 then 'paid' else 'creating' end,
    paid_at = case when v_cash = 0 then now() end where id = v_order;
  if v_coins > 0 then
    insert into public.loyalty_ledger(customer_id,points,kind,store_order_id,note)
    values (v_customer,-v_coins,'spent',v_order,'Compra na loja · Caracoins reservadas');
  end if;
  return v_order;
end;
$$;

revoke all on function public.checkout_store_cart_live(uuid,jsonb) from public,anon,authenticated,service_role;

-- O ponto de entrada antigo continua desativado; a vitrine usa a versão com frete.
create or replace function public.checkout_store_cart(p_request_key uuid,p_items jsonb)
returns uuid language plpgsql security definer set search_path='' as $$begin
 raise exception 'Atualize a loja e confirme o carrinho para comprar.';
end $$;
revoke all on function public.checkout_store_cart(uuid,jsonb) from public,anon,service_role;
grant execute on function public.checkout_store_cart(uuid,jsonb) to authenticated;
revoke all on function public.checkout_store_cart_before_shipping(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.checkout_store_cart_before_freight(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
