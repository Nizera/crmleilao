-- Valida o Pix do frete antes de reservar moedas e estoque. Não abre a loja.
begin;
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

commit;
