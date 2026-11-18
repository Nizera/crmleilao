-- Keep every retry inside Meta's 48-hour deduplication horizon, with safety margin.
CREATE OR REPLACE FUNCTION public.claim_store_meta_events(p_limit integer DEFAULT 5)
 RETURNS SETOF store_meta_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 update public.store_meta_events e set status='skipped',error_code='consent_or_payment_unavailable'
 where e.status in ('pending','processing') and not exists(
 select 1 from public.store_order_attribution a join public.store_marketing_sessions s on s.id=a.session_id
 join public.store_orders o on o.id=a.order_id where a.order_id=e.order_id and s.consent and s.expires_at>now() and o.payment_status='paid');
 update public.store_meta_events set status='failed',error_code='delivery_window_exceeded'
 where status in ('pending','processing') and (event_time<now()-interval '36 hours' or attempts>=10);
 return query with candidates as (
 select id from public.store_meta_events where next_attempt_at<=now() and
 (status='pending' or(status='processing' and claimed_at<now()-interval '5 minutes'))
 order by next_attempt_at,id for update skip locked limit greatest(1,least(p_limit,20))
 ) update public.store_meta_events e set status='processing',claimed_at=now(),lease_token=gen_random_uuid(),attempts=attempts+1
 from candidates c where e.id=c.id returning e.*;
end; $function$;
