begin;
alter table public.raffle_campaigns add column price_tiers jsonb not null default '[]'::jsonb check(jsonb_typeof(price_tiers)='array' and jsonb_array_length(price_tiers)<=10);
alter table public.raffle_orders add column base_unit_price numeric(10,2), add column applied_unit_price numeric(10,2), add column discount_amount numeric(12,2) not null default 0 check(discount_amount>=0), add column price_tier_min integer;
update public.raffle_orders set base_unit_price=round(amount/cardinality(numbers),2),applied_unit_price=round(amount/cardinality(numbers),2);
create function public.set_raffle_price_tiers(p_campaign uuid,p_tiers jsonb,p_expected jsonb) returns void language plpgsql security definer set search_path='' as $$
declare c public.raffle_campaigns%rowtype; t jsonb; n numeric; price numeric; prev_n integer:=1; prev_price numeric; canonical jsonb:='[]'::jsonb;
begin
 if not public.has_staff_write() then raise exception 'Acesso negado.' using errcode='42501';end if;
 select * into c from public.raffle_campaigns where id=p_campaign for update;
 if not found or c.status not in ('draft','paused') or c.archived_at is not null then raise exception 'Pause a campanha antes de alterar as promoções.';end if;
 if c.price_tiers is distinct from p_expected then raise exception 'As promoções mudaram. Atualize a página antes de salvar.';end if;
 if jsonb_typeof(p_tiers) is distinct from 'array' then raise exception 'Promoções inválidas.';end if;
 if jsonb_array_length(p_tiers)>10 then raise exception 'Use até 10 faixas de promoção.';end if;
 prev_price:=c.unit_price;
 for t in select value from jsonb_array_elements(p_tiers) order by (value->>'min_quantity')::numeric loop
  if jsonb_typeof(t->'min_quantity') is distinct from 'number' or jsonb_typeof(t->'unit_price') is distinct from 'number' then raise exception 'Promoção inválida.';end if;
  n:=(t->>'min_quantity')::numeric;price:=(t->>'unit_price')::numeric;
  if n<>trunc(n) or n<=prev_n or n>c.max_quantity or price<=0 or price>=prev_price or price<>round(price,2) then raise exception 'Revise as quantidades e os preços: cada faixa deve ter quantidade maior e preço menor.';end if;
  canonical:=canonical||jsonb_build_array(jsonb_build_object('min_quantity',n::integer,'unit_price',price));prev_n:=n::integer;prev_price:=price;
 end loop;
 update public.raffle_campaigns set price_tiers=canonical where id=c.id;
 insert into public.raffle_events(campaign_id,actor,action) values(c.id,auth.uid(),'Promoções por quantidade: '||canonical::text);
end;$$;
revoke all on function public.set_raffle_price_tiers(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.set_raffle_price_tiers(uuid,jsonb,jsonb) to authenticated;
create function public.save_raffle_campaign_with_promotions(p_data jsonb,p_tiers jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 cid:=public.save_raffle_campaign(p_data);
 perform public.set_raffle_price_tiers(cid,p_tiers,'[]'::jsonb);
 return cid;
end;$$;
revoke all on function public.save_raffle_campaign_with_promotions(jsonb,jsonb) from public,anon;
grant execute on function public.save_raffle_campaign_with_promotions(jsonb,jsonb) to authenticated;
create or replace function public.reserve_raffle(p_campaign uuid,p_key uuid,p_numbers integer[] default null,p_quantity integer default null) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.raffle_campaigns%rowtype; customer uuid; existing public.raffle_orders%rowtype; ns integer[]; qty integer; oid uuid; price numeric; tier_min integer;
begin
 customer:=public.current_customer_id();
 if customer is null then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_key is null then raise exception 'Pedido inválido.'; end if;
 select * into c from public.raffle_campaigns where id=p_campaign for update;
 if not found then raise exception 'Campanha não encontrada.'; end if;
 select * into existing from public.raffle_orders where customer_id=customer and request_key=p_key;
 if found then
  if existing.campaign_id<>p_campaign then raise exception 'Chave de pedido já utilizada.'; end if;
  return existing.id;
 end if;
 if not coalesce((select purchases_enabled from public.raffle_settings where id=true),false) then raise exception 'As compras de cotas ainda não foram liberadas.'; end if;
 if c.archived_at is not null or c.status<>'open' then raise exception 'Esta campanha não está recebendo reservas.'; end if;
 if not exists(select 1 from public.customers where id=customer and nullif(btrim(email),'') is not null) then raise exception 'Preencha seu e-mail no cadastro antes de comprar.'; end if;
 if exists(select 1 from public.raffle_orders where campaign_id=c.id and customer_id=customer and status in ('creating','pending','review')) then raise exception 'Você já tem uma reserva aberta nesta campanha. Retome em Minhas cotas.'; end if;
 if p_numbers is not null then
  if c.selection_mode='automatic' then raise exception 'Esta campanha usa seleção automática.'; end if;
  qty:=cardinality(p_numbers);
  if qty is null or array_ndims(p_numbers)<>1 or qty<> (select count(distinct x) from unnest(p_numbers) x) then raise exception 'Cotas repetidas ou inválidas.'; end if;
  if exists(select 1 from unnest(p_numbers) x where x is null or x<0 or x>=c.total_numbers) then raise exception 'Cota fora do intervalo.'; end if;
  ns:=p_numbers;
 else
  if c.selection_mode='manual' then raise exception 'Escolha os números desta campanha.'; end if;
  qty:=p_quantity;
 end if;
 if qty is null or qty<c.min_quantity or qty>c.max_quantity then raise exception 'Quantidade fora dos limites da campanha.'; end if;
 if ns is null then
  select array_agg(x.number order by x.number) into ns from (select g as number from generate_series(0,c.total_numbers-1) g
   where not exists(select 1 from public.raffle_allocations a where a.campaign_id=c.id and a.number=g)
   order by gen_random_uuid() limit qty) x;
 end if;
 if coalesce(cardinality(ns),0)<>qty or exists(select 1 from public.raffle_allocations where campaign_id=c.id and number=any(ns)) then raise exception 'Algumas cotas acabaram de ser reservadas. Atualize e escolha novamente.'; end if;
 select t.unit_price,t.min_quantity into price,tier_min from jsonb_to_recordset(c.price_tiers) as t(min_quantity integer,unit_price numeric) where t.min_quantity<=qty order by t.min_quantity desc limit 1;
 price:=coalesce(price,c.unit_price);
 insert into public.raffle_orders(campaign_id,customer_id,request_key,amount,numbers,base_unit_price,applied_unit_price,discount_amount,price_tier_min)
 values(c.id,customer,p_key,price*qty,ns,c.unit_price,price,(c.unit_price-price)*qty,tier_min) returning id into oid;
 insert into public.raffle_allocations(campaign_id,number,order_id) select c.id,x,oid from unnest(ns) x;
 return oid;
end; $$;
create function public.reserve_raffle_at_price(p_campaign uuid,p_key uuid,p_numbers integer[],p_quantity integer,p_expected_amount numeric,p_expected_unit_price numeric) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.raffle_campaigns%rowtype; customer uuid; existing public.raffle_orders%rowtype; qty integer; price numeric;
begin
 customer:=public.current_customer_id();
 if customer is null then raise exception 'Acesso negado.' using errcode='42501';end if;
 if p_key is null then raise exception 'Pedido inválido.';end if;
 select * into c from public.raffle_campaigns where id=p_campaign for update;
 if not found then raise exception 'Campanha não encontrada.';end if;
 select * into existing from public.raffle_orders where customer_id=customer and request_key=p_key;
 if found then
  if existing.campaign_id<>p_campaign then raise exception 'Chave de pedido já utilizada.';end if;
  return existing.id;
 end if;
 qty:=case when p_numbers is not null then cardinality(p_numbers) else p_quantity end;
 select t.unit_price into price from jsonb_to_recordset(c.price_tiers) as t(min_quantity integer,unit_price numeric) where t.min_quantity<=qty order by t.min_quantity desc limit 1;
 price:=coalesce(price,c.unit_price);
 if p_expected_amount is null or p_expected_unit_price is null or p_expected_amount<>price*qty or p_expected_unit_price<>price then raise exception 'O preço da campanha mudou. Atualize a página e confira o novo total.';end if;
 return public.reserve_raffle(p_campaign,p_key,p_numbers,p_quantity);
end;$$;
revoke all on function public.reserve_raffle_at_price(uuid,uuid,integer[],integer,numeric,numeric) from public,anon;
grant execute on function public.reserve_raffle_at_price(uuid,uuid,integer[],integer,numeric,numeric) to authenticated;
-- Retorna somente estados ocupados. Números disponíveis são montados no
-- navegador, evitando gerar/enviar milhares de objetos a cada atualização.
create or replace function public.get_public_raffle_number_states(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.raffle_campaigns%rowtype;
begin
 select * into c from public.raffle_campaigns where id=p_campaign
   and ((status in ('open','paused','closed') and archived_at is null) or public.is_admin());
 if not found then raise exception 'Campanha não encontrada.';end if;
 return jsonb_build_object('total',c.total_numbers,'unit_price',c.unit_price,'price_tiers',c.price_tiers,'occupied',(
   select coalesce(jsonb_agg(jsonb_build_object('number',a.number,'state',case when o.status='paid' then 'paid' else 'reserved' end) order by a.number),'[]'::jsonb)
   from public.raffle_allocations a join public.raffle_orders o on o.id=a.order_id
   where a.campaign_id=c.id and o.campaign_id=c.id
 ));
end;
$$;
revoke all on function public.get_public_raffle_number_states(uuid) from public;
grant execute on function public.get_public_raffle_number_states(uuid) to anon,authenticated;
commit;
