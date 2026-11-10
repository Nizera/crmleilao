begin;
-- Somente o servidor, após autenticar a equipe e conferir a cobrança externa.
create or replace function public.manage_raffle_reservation(p_order uuid,p_actor uuid,p_action text,p_reason text,p_provider_closed boolean)
returns void language plpgsql security definer set search_path='' as $$
declare o public.raffle_orders%rowtype; cid uuid;
begin
 if not exists(select 1 from public.admin_profiles where id=p_actor and role in('owner','staff')) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_action not in('paid_external','cancel','refund_confirmed') or p_reason is null or char_length(btrim(p_reason)) not between 10 and 500 then raise exception 'Informe a ação e o motivo (10 a 500 caracteres).'; end if;
 select campaign_id into cid from public.raffle_orders where id=p_order;
 perform 1 from public.raffle_campaigns where id=cid for update;
 select * into o from public.raffle_orders where id=p_order for update;
 if not found or o.status<>'pending' then raise exception 'A reserva mudou. Atualize a tela; reservas pagas ou encerradas exigem conferência própria.'; end if;
 if o.mp_order_id is not null and not coalesce(p_provider_closed,false) and p_action<>'refund_confirmed' then raise exception 'Encerre o Pix no provedor antes de alterar a reserva.'; end if;
 if p_action='paid_external' then
  if exists(select 1 from public.raffle_awards a join public.raffle_prizes p on p.id=a.prize_id where a.campaign_id=cid and p.kind='main') then raise exception 'Campanha já apurada.'; end if;
  if (select count(*) from public.raffle_allocations where order_id=o.id and campaign_id=cid and number=any(o.numbers))<>cardinality(o.numbers) then raise exception 'Uma das cotas não está mais reservada para este pedido.'; end if;
 end if;
 perform public.settle_raffle_payment(o.external_reference,coalesce(o.mp_order_id,'MANUAL_'||o.id::text),o.amount,case when p_action='paid_external' then 'paid' else 'cancelled' end);
 insert into public.raffle_events(campaign_id,actor,action) values(cid,p_actor,'Ajuste manual '||o.code||' ['||p_action||']: '||btrim(p_reason));
end; $$;
revoke all on function public.manage_raffle_reservation(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.manage_raffle_reservation(uuid,uuid,text,text,boolean) to service_role;
commit;
