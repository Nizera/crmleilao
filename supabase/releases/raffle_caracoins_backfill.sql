-- Retrospective credit requested by the administrator; rates use the tier at credit.
-- This does not rewrite purchases or existing credits/debits. It is safe to retry.
begin;
lock table public.raffle_orders in share row exclusive mode;
do $$ declare o record;previous_rows jsonb;
begin
 if not exists(select 1 from public.loyalty_settings where id and active) then raise exception 'O programa de Caracoins está desativado.';end if;
 select jsonb_object_agg(id::text,md5(to_jsonb(l)::text)) into previous_rows from public.loyalty_ledger l;
 for o in select r.id from public.raffle_orders r
 where r.status='paid' and not exists(select 1 from public.loyalty_ledger l where l.raffle_order_id=r.id and l.kind='earned')
 order by r.paid_at nulls last,r.id
 loop perform public.credit_paid_raffle_caracoins(o.id);end loop;
 if exists(select 1 from jsonb_each_text(coalesce(previous_rows,'{}'::jsonb)) old left join public.loyalty_ledger l on l.id::text=old.key where l.id is null or md5(to_jsonb(l)::text) is distinct from old.value) then raise exception 'Um registro anterior mudou; crédito revertido para conferência.';end if;
end;$$;
commit;
