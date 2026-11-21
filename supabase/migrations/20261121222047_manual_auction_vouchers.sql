begin;
alter table public.auction_vouchers alter column campaign_id drop not null;
alter table public.auction_vouchers add column issuance_note text;
alter table public.auction_vouchers add constraint auction_vouchers_manual_origin check (campaign_id is not null or nullif(btrim(issuance_note),'') is not null);
CREATE OR REPLACE FUNCTION public.get_admin_auction_voucher_detail(p_voucher uuid, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare header jsonb;movements_count integer;lots_count integer;page integer;
begin
 if auth.uid() is null or public.is_admin() is not true then raise exception 'Acesso negado.' using errcode='42501';end if;
 select jsonb_build_object('id',v.id,'customer_id',v.customer_id,'customer_name',c.name,'phone_e164',c.phone_e164,
  'title',v.title,'campaign_title',coalesce(campaign.title,'Emissão manual'),'campaign_id',v.campaign_id,'amount',v.amount,'remaining',v.remaining,'status',coalesce(r.status,'fulfilled'))
 into header from public.auction_vouchers v join public.customers c on c.id=v.customer_id
 left join public.raffle_buyer_results r on r.campaign_id=v.campaign_id left join public.raffle_campaigns campaign on campaign.id=v.campaign_id where v.id=p_voucher;
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
end;$function$
;
CREATE OR REPLACE FUNCTION public.get_admin_auction_voucher_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   'available',coalesce(sum(v.remaining) filter(where (v.campaign_id is null or r.status<>'review')),0),
   'reserved',coalesce(sum(a.reserved),0),'used',coalesce(sum(a.used),0),
   'review',coalesce(sum(v.remaining) filter(where r.status='review'),0),
   'clients',count(distinct v.customer_id) filter(where v.remaining>0 and (v.campaign_id is null or r.status<>'review')),
   'vouchers',count(v.id)
  ) from public.auction_vouchers v left join public.raffle_buyer_results r on r.campaign_id=v.campaign_id
  left join allocations a on a.auction_voucher_id=v.id
 );
end;$function$
;
CREATE OR REPLACE FUNCTION public.get_admin_auction_vouchers(p_query text DEFAULT ''::text, p_status text DEFAULT 'all'::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    v.remaining,coalesce(r.status,'fulfilled') as status,coalesce(campaign.title,'Emissão manual') as campaign_title,v.campaign_id,v.created_at,
    coalesce(a.reserved,0) reserved,coalesce(a.used,0) used
   from public.auction_vouchers v left join public.raffle_buyer_results r on r.campaign_id=v.campaign_id
   left join public.raffle_campaigns campaign on campaign.id=v.campaign_id join public.customers c on c.id=v.customer_id
   left join allocations a on a.auction_voucher_id=v.id
   where (coalesce(btrim(p_query),'')='' or position(lower(left(btrim(p_query),120)) in lower(coalesce(c.name,'')||' '||coalesce(c.phone_e164,'')||' '||v.title||' '||coalesce(campaign.title,'Emissão manual')))>0)
   and (p_status='all' or (p_status='available' and v.remaining>0 and (v.campaign_id is null or r.status<>'review'))
    or (p_status='reserved' and coalesce(a.reserved,0)>0) or (p_status='used' and coalesce(a.used,0)>0)
    or (p_status='review' and r.status='review'))
  ), meta as (select count(*) total from filtered), paging as (
   select greatest(1,least(coalesce(p_page,1),10000,greatest(1,ceil(total/25.0)::integer))) page,total from meta
  ), items as (select * from filtered order by created_at desc,id limit 25 offset ((select page from paging)-1)*25)
  select jsonb_build_object('summary',public.get_admin_auction_voucher_summary(),'total',paging.total,'page',paging.page,
   'items',coalesce((select jsonb_agg(to_jsonb(items) order by created_at desc,id) from items),'[]'::jsonb)) from paging
 );
end;$function$
;
CREATE OR REPLACE FUNCTION public.get_auction_vouchers(p_customer uuid DEFAULT NULL::uuid, p_lot uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c uuid;
begin
 if public.is_admin() and auth.uid() is not null then c:=p_customer;
 else c:=public.current_customer_id();if c is null or (p_customer is not null and p_customer<>c) or p_lot is not null then raise exception 'Acesso negado.' using errcode='42501';end if;end if;
 if c is null then return '[]'::jsonb;end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'title',v.title,'amount',v.amount,'remaining',v.remaining,'available',v.remaining+coalesce(l.voucher_amount,0)) order by v.created_at,v.id),'[]'::jsonb)
 from public.auction_vouchers v left join public.raffle_buyer_results r on r.campaign_id=v.campaign_id
 left join public.lots l on l.id=p_lot and l.customer_id=c and l.auction_voucher_id=v.id and l.status<>'cancelled'
 where v.customer_id=c and (v.campaign_id is null or r.status<>'review') and (v.remaining>0 or l.voucher_amount>0));
end;$function$
;
commit;
