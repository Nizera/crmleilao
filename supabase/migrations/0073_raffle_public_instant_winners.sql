begin;
create index if not exists raffle_awards_campaign_prize on public.raffle_awards(campaign_id,prize_id);

-- Reuse the number-state request; do not add polling or expose private contacts.
create or replace function public.get_public_raffle_number_states(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.raffle_campaigns%rowtype;
begin
 select * into c from public.raffle_campaigns where id=p_campaign
   and ((status in ('open','paused','closed') and archived_at is null) or public.is_admin());
 if not found then raise exception 'Campanha não encontrada.';end if;
 return jsonb_build_object('total',c.total_numbers,'unit_price',c.unit_price,
  'price_tiers',coalesce(to_jsonb(c)->'price_tiers','[]'::jsonb),
  'occupied',(
   select coalesce(jsonb_agg(jsonb_build_object('number',a.number,'state',case when o.status='paid' then 'paid' else 'reserved' end) order by a.number),'[]'::jsonb)
   from public.raffle_allocations a join public.raffle_orders o on o.id=a.order_id
   where a.campaign_id=c.id and o.campaign_id=c.id
  ),
  'instant_awards',(
   select coalesce(jsonb_agg(jsonb_build_object('prize_id',result.prize_id,'confirmed',result.confirmed,
    'number',case when result.confirmed then result.number else null end,
    'winner_name',case when result.confirmed then result.public_name else null end) order by result.prize_id),'[]'::jsonb)
   from (
    select p.id as prize_id,a.number,
     (o.status='paid' and l.cancelled_at is null and o.customer_id=a.customer_id
      and a.number=p.number and exists(select 1 from public.raffle_allocations ra where ra.campaign_id=c.id and ra.order_id=o.id and ra.number=a.number)) as confirmed,
     case when nullif(btrim(customer.name),'') is null then 'Participante'
      when strpos(btrim(customer.name),' ')=0 then btrim(customer.name)
      else split_part(btrim(customer.name),' ',1)||' '||left(regexp_replace(btrim(customer.name),'^.*\s',''),1)||'.' end as public_name
    from public.raffle_awards a
    join public.raffle_prizes p on p.id=a.prize_id and p.campaign_id=c.id and p.kind='instant'
    join public.raffle_orders o on o.id=a.order_id and o.campaign_id=c.id
    join public.logistics_pending l on l.id=a.logistics_id
    join public.customers customer on customer.id=a.customer_id
    where a.campaign_id=c.id
   ) result
  ));
end;
$$;
revoke all on function public.get_public_raffle_number_states(uuid) from public;
grant execute on function public.get_public_raffle_number_states(uuid) to anon,authenticated;
commit;
