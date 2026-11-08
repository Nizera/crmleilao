begin;

-- Retorna somente estados ocupados. Números disponíveis são montados no
-- navegador, evitando gerar/enviar milhares de objetos a cada atualização.
create or replace function public.get_public_raffle_number_states(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.raffle_campaigns%rowtype;
begin
 select * into c from public.raffle_campaigns where id=p_campaign
   and ((status in ('open','paused','closed') and archived_at is null) or public.is_admin());
 if not found then raise exception 'Campanha não encontrada.';end if;
 return jsonb_build_object('total',c.total_numbers,'occupied',(
   select coalesce(jsonb_agg(jsonb_build_object('number',a.number,'state',case when o.status='paid' then 'paid' else 'reserved' end) order by a.number),'[]'::jsonb)
   from public.raffle_allocations a join public.raffle_orders o on o.id=a.order_id
   where a.campaign_id=c.id and o.campaign_id=c.id
 ));
end;
$$;
revoke all on function public.get_public_raffle_number_states(uuid) from public;
grant execute on function public.get_public_raffle_number_states(uuid) to anon,authenticated;

commit;
