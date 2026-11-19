-- Read-only administrative reporting. No balances, awards or payment rules are changed.
begin;
create function public.get_admin_auction_voucher_summary() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.is_admin() is not true then raise exception 'Acesso negado.' using errcode='42501';end if;
 return (
  with allocations as (
   select auction_voucher_id,
    coalesce(sum(voucher_amount) filter(where status='pending_payment'),0) reserved,
    coalesce(sum(voucher_amount) filter(where status in('paid','shipped','delivered')),0) used
   from public.lots where auction_voucher_id is not null group by auction_voucher_id
  ) select jsonb_build_object(
   'issued',coalesce(sum(v.amount),0),
   'available',coalesce(sum(v.remaining) filter(where r.status<>'review'),0),
   'reserved',coalesce(sum(a.reserved),0),'used',coalesce(sum(a.used),0),
   'review',coalesce(sum(v.remaining) filter(where r.status='review'),0),
   'clients',count(distinct v.customer_id) filter(where v.remaining>0 and r.status<>'review'),
   'vouchers',count(v.id)
  ) from public.auction_vouchers v join public.raffle_buyer_results r on r.campaign_id=v.campaign_id
  left join allocations a on a.auction_voucher_id=v.id
 );
end;$$;

create function public.get_admin_auction_vouchers(p_query text default '',p_status text default 'all',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.is_admin() is not true then raise exception 'Acesso negado.' using errcode='42501';end if;
 if p_status is null or p_status not in('all','available','reserved','used','review') then raise exception 'Filtro inválido.';end if;
 return (
  with allocations as (
   select auction_voucher_id,
    coalesce(sum(voucher_amount) filter(where status='pending_payment'),0) reserved,
    coalesce(sum(voucher_amount) filter(where status in('paid','shipped','delivered')),0) used
   from public.lots where auction_voucher_id is not null group by auction_voucher_id
  ), filtered as (
   select v.id,v.customer_id,c.name as customer_name,c.phone_e164,v.title,v.amount,
    v.remaining,r.status,campaign.title as campaign_title,v.campaign_id,v.created_at,
    coalesce(a.reserved,0) reserved,coalesce(a.used,0) used
   from public.auction_vouchers v join public.raffle_buyer_results r on r.campaign_id=v.campaign_id
   join public.raffle_campaigns campaign on campaign.id=v.campaign_id join public.customers c on c.id=v.customer_id
   left join allocations a on a.auction_voucher_id=v.id
   where (coalesce(btrim(p_query),'')='' or position(lower(left(btrim(p_query),120)) in lower(coalesce(c.name,'')||' '||coalesce(c.phone_e164,'')||' '||v.title||' '||campaign.title))>0)
   and (p_status='all' or (p_status='available' and v.remaining>0 and r.status<>'review')
    or (p_status='reserved' and coalesce(a.reserved,0)>0) or (p_status='used' and coalesce(a.used,0)>0)
    or (p_status='review' and r.status='review'))
  ), meta as (select count(*) total from filtered), paging as (
   select greatest(1,least(coalesce(p_page,1),10000,greatest(1,ceil(total/25.0)::integer))) page,total from meta
  ), items as (select * from filtered order by created_at desc,id limit 25 offset ((select page from paging)-1)*25)
  select jsonb_build_object('summary',public.get_admin_auction_voucher_summary(),'total',paging.total,'page',paging.page,
   'items',coalesce((select jsonb_agg(to_jsonb(items) order by created_at desc,id) from items),'[]'::jsonb)) from paging
 );
end;$$;

create function public.get_admin_auction_voucher_detail(p_voucher uuid,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare header jsonb;movements_count integer;lots_count integer;page integer;
begin
 if auth.uid() is null or public.is_admin() is not true then raise exception 'Acesso negado.' using errcode='42501';end if;
 select jsonb_build_object('id',v.id,'customer_id',v.customer_id,'customer_name',c.name,'phone_e164',c.phone_e164,
  'title',v.title,'campaign_title',campaign.title,'campaign_id',v.campaign_id,'amount',v.amount,'remaining',v.remaining,'status',r.status)
 into header from public.auction_vouchers v join public.customers c on c.id=v.customer_id
 join public.raffle_buyer_results r on r.campaign_id=v.campaign_id join public.raffle_campaigns campaign on campaign.id=v.campaign_id where v.id=p_voucher;
 if header is null then return null;end if;
 select count(*) into movements_count from public.auction_voucher_movements where voucher_id=p_voucher;
 select count(*) into lots_count from public.lots where auction_voucher_id=p_voucher;
 page:=greatest(1,least(coalesce(p_page,1),10000,greatest(1,ceil(greatest(movements_count,lots_count)/25.0)::integer)));
 return jsonb_build_object('voucher',header,'page',page,'total',greatest(movements_count,lots_count),'movements_total',movements_count,'lots_total',lots_count,
  'movements',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id) from (
   select m.id,m.lot_id,m.delta,m.created_at,l.code as lot_code from public.auction_voucher_movements m left join public.lots l on l.id=m.lot_id
   where m.voucher_id=p_voucher order by m.created_at desc,m.id limit 25 offset (page-1)*25
  ) x),'[]'::jsonb),
  'lots',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id) from (
   select l.id,l.code,l.title,l.status,l.arremate_value,l.voucher_amount,l.created_at from public.lots l
   where l.auction_voucher_id=p_voucher order by l.created_at desc,l.id limit 25 offset (page-1)*25
  ) x),'[]'::jsonb));
end;$$;

create function public.get_admin_loyalty_ranking(p_query text default '',p_tier text default 'all',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.is_admin() is not true then raise exception 'Acesso negado.' using errcode='42501';end if;
 if p_tier is null or p_tier not in('all','lilas','bronze','prata','ouro','crumple','prizm') then raise exception 'Elo inválido.';end if;
 return (
  with contributions as (
   select customer_id,rank_points as points from public.loyalty_rank_history
   union all select customer_id,points from public.loyalty_ledger
   where kind in('earned','reversal') or (kind='adjustment' and note='Recalibração histórica de pontos (migração 0022)')
  ), earned as (select customer_id,sum(points) as points from contributions group by customer_id), ranked as (
   select c.id,c.name,c.phone_e164,c.loyalty_rank_visible as rank_visible,coalesce(e.points,0) as points,
    rank() over(order by coalesce(e.points,0) desc) as position,
    case when coalesce(e.points,0)<1000 then 'lilas' when e.points<5000 then 'bronze' when e.points<15000 then 'prata'
     when e.points<25000 then 'ouro' when e.points<50000 then 'crumple' else 'prizm' end as tier_key
   from public.customers c left join earned e on e.customer_id=c.id
  ), filtered as (
   select * from ranked where (p_tier='all' or tier_key=p_tier)
   and (coalesce(btrim(p_query),'')='' or position(lower(left(btrim(p_query),120)) in lower(coalesce(name,'')||' '||coalesce(phone_e164,'')))>0)
  ), meta as (select count(*) total from filtered), paging as (
   select greatest(1,least(coalesce(p_page,1),10000,greatest(1,ceil(total/25.0)::integer))) page,total from meta
  ), items as (select * from filtered order by points desc,id limit 25 offset ((select page from paging)-1)*25)
  select jsonb_build_object('total',paging.total,'page',paging.page,
   'customers',(select count(*) from ranked),'public_enabled',coalesce((select active and ranking_enabled from public.loyalty_settings where id=true),false),
   'tiers',coalesce((select jsonb_object_agg(tier_key,n) from(select tier_key,count(*) n from ranked group by tier_key)t),'{}'::jsonb),
   'items',coalesce((select jsonb_agg(to_jsonb(items) order by points desc,id) from items),'[]'::jsonb)) from paging
 );
end;$$;

revoke all on function public.get_admin_auction_voucher_summary(),public.get_admin_auction_vouchers(text,text,integer),public.get_admin_auction_voucher_detail(uuid,integer),public.get_admin_loyalty_ranking(text,text,integer) from public,anon;
grant execute on function public.get_admin_auction_voucher_summary(),public.get_admin_auction_vouchers(text,text,integer),public.get_admin_auction_voucher_detail(uuid,integer),public.get_admin_loyalty_ranking(text,text,integer) to authenticated;
commit;
notify pgrst, 'reload schema';
