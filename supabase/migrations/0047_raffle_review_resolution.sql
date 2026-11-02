begin;
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
commit;
