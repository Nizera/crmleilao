begin;
create or replace function public.get_shipment_cost_summary(
  p_day date default null, p_query text default '', p_status text default 'all', p_cost text default 'all'
) returns jsonb language sql stable security invoker set search_path='' as $$
  with filtered as (
    select s.* from public.shipments s left join public.customers c on c.id=s.customer_id
    where public.is_admin()
      and (p_day is null or s.batch_date=p_day)
      and (p_status='all' or s.status::text=p_status)
      and (p_cost='all' or (s.price_change_count>0 and (
        p_cost='changed' or (p_cost='increase' and s.price_difference>0) or (p_cost='decrease' and s.price_difference<0))))
      and (length(trim(p_query))<2 or
        strpos(lower(s.code),lower(trim(p_query)))>0 or
        strpos(lower(s.sf_order_id),lower(trim(p_query)))>0 or
        strpos(lower(coalesce(s.tracking_code,'')),lower(trim(p_query)))>0 or
        strpos(lower(coalesce(c.name,'')),lower(trim(p_query)))>0 or
        (length(regexp_replace(p_query,'[^0-9]','','g'))>=4 and
          strpos(c.phone_e164,regexp_replace(p_query,'[^0-9]','','g'))>0))
  ) select jsonb_build_object(
    'labels', count(*) filter(where status::text<>'cancelled'),
    'cancelled', count(*) filter(where status::text='cancelled'),
    'emissionTotal', coalesce(sum(coalesce(original_price,price)) filter(where status::text<>'cancelled'),0),
    'currentTotal', coalesce(sum(coalesce(price,original_price)) filter(where status::text<>'cancelled'),0),
    'adjustmentTotal', coalesce(sum(coalesce(price,original_price)-coalesce(original_price,price)) filter(where status::text<>'cancelled'),0),
    'changedLabels', count(*) filter(where status::text<>'cancelled' and price is not null and original_price is not null and price<>original_price),
    'unknownPrices', count(*) filter(where status::text<>'cancelled' and coalesce(original_price,price) is null),
    'legacyPrices', count(*) filter(where status::text<>'cancelled' and price_baseline_legacy)
  ) from filtered;
$$;
revoke all on function public.get_shipment_cost_summary(date,text,text,text) from public,anon;
grant execute on function public.get_shipment_cost_summary(date,text,text,text) to authenticated,service_role;
commit;
