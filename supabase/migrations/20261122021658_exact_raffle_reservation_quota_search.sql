CREATE OR REPLACE FUNCTION public.list_raffle_admin_orders(p_campaign uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_search text DEFAULT ''::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; total bigint; query text:=left(btrim(coalesce(p_search,'')),100); quota_search boolean;
begin
 if public.is_admin() is not true then raise exception 'Acesso negado.' using errcode='42501'; end if;
 quota_search:=query~'^[0-9]{1,9}$';
 select count(*) into total from public.raffle_orders o join public.customers c on c.id=o.customer_id
 where (p_campaign is null or o.campaign_id=p_campaign) and (p_status is null or o.status=p_status)
 and (query='' or case when quota_search then exists(select 1 from unnest(o.numbers) n where n::text=coalesce(nullif(ltrim(query,'0'),''),'0')) else strpos(lower(c.name),lower(query))>0 or strpos(c.phone_e164,query)>0 or strpos(lower(o.code),lower(query))>0 end);
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
 select o.id,o.campaign_id,o.code,o.status,o.numbers,o.amount,o.created_at,c.name customer_name,c.phone_e164,r.title campaign_title,r.total_numbers,
 exists(select 1 from public.raffle_awards a where a.order_id=o.id) has_award
 from public.raffle_orders o join public.customers c on c.id=o.customer_id join public.raffle_campaigns r on r.id=o.campaign_id
 where (p_campaign is null or o.campaign_id=p_campaign) and (p_status is null or o.status=p_status)
 and (query='' or case when quota_search then exists(select 1 from unnest(o.numbers) n where n::text=coalesce(nullif(ltrim(query,'0'),''),'0')) else strpos(lower(c.name),lower(query))>0 or strpos(c.phone_e164,query)>0 or strpos(lower(o.code),lower(query))>0 end)
 order by o.created_at desc,o.id limit 20 offset (greatest(1,least(coalesce(p_page,1),10000))-1)*20) x;
 return jsonb_build_object('total',total,'items',result);
end; $function$
;
