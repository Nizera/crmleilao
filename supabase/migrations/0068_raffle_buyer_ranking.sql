begin;

-- Somente estatísticas de campanhas publicadas. Não retorna contatos,
-- identificadores de clientes, pedidos ou números de cotas.
create or replace function public.get_public_raffle_buyer_ranking(p_campaign uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 with buyers as (
   select o.customer_id,count(*)::integer as quantity,min(o.paid_at) as first_paid
   from public.raffle_allocations a
   join public.raffle_orders o on o.id=a.order_id
   join public.raffle_campaigns c on c.id=a.campaign_id
   where a.campaign_id=p_campaign and o.campaign_id=c.id and o.status='paid'
     and c.status in ('open','paused','closed') and c.archived_at is null
   group by o.customer_id
 ), ranked as (
   select case when nullif(btrim(c.name),'') is null then 'Participante'
     when strpos(btrim(c.name),' ')=0 then btrim(c.name)
     else split_part(btrim(c.name),' ',1)||' '||left(regexp_replace(btrim(c.name),'^.*\s',''),1)||'.' end as name,
     b.quantity,row_number() over(order by b.quantity desc,b.first_paid,b.customer_id)::integer as position
   from buyers b join public.customers c on c.id=b.customer_id
   order by b.quantity desc,b.first_paid,b.customer_id limit 3
 ) select coalesce(jsonb_agg(jsonb_build_object('name',name,'quantity',quantity,'position',position) order by position),'[]'::jsonb) from ranked;
$$;
revoke all on function public.get_public_raffle_buyer_ranking(uuid) from public;
grant execute on function public.get_public_raffle_buyer_ranking(uuid) to anon,authenticated;

commit;
