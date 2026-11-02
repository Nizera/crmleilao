-- Pausa as vendas quando todas as cotas têm pagamento confirmado.
-- Não apura, não escolhe ganhador e não libera reservas pelo relógio.
begin;
create function public.pause_paid_out_raffle() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'paid' or old.status='paid' then return new; end if;
 perform 1 from public.raffle_campaigns where id=new.campaign_id for update;
 update public.raffle_campaigns c set status='paused'
 where c.id=new.campaign_id and c.status='open'
 and c.total_numbers=(select count(*) from public.raffle_allocations a
 join public.raffle_orders o on o.id=a.order_id
 where a.campaign_id=c.id and o.status='paid');
 if found then
  insert into public.raffle_events(campaign_id,action)
  values(new.campaign_id,'Todas as cotas pagas: vendas pausadas para apuração');
 end if;
 return new;
end; $$;
revoke all on function public.pause_paid_out_raffle() from public,anon,authenticated;
create trigger raffle_pause_when_paid_out after update of status on public.raffle_orders
for each row execute function public.pause_paid_out_raffle();

create function public.prevent_reopening_paid_out_raffle() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='open' and new.total_numbers=(select count(*) from public.raffle_allocations a
 join public.raffle_orders o on o.id=a.order_id where a.campaign_id=new.id and o.status='paid') then
  raise exception 'Todas as cotas já foram pagas. A campanha está pronta para apuração.';
 end if;
 return new;
end; $$;
revoke all on function public.prevent_reopening_paid_out_raffle() from public,anon,authenticated;
create trigger raffle_prevent_reopening_paid_out before update of status on public.raffle_campaigns
for each row execute function public.prevent_reopening_paid_out_raffle();

-- Atualiza também campanhas que já estavam completamente pagas antes desta regra.
with paused as (
 update public.raffle_campaigns c set status='paused'
 where c.status='open' and c.total_numbers=(select count(*) from public.raffle_allocations a
 join public.raffle_orders o on o.id=a.order_id where a.campaign_id=c.id and o.status='paid')
 returning id
)
insert into public.raffle_events(campaign_id,action)
select id,'Todas as cotas pagas: vendas pausadas para apuração' from paused;
commit;
