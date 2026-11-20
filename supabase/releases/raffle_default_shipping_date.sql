-- Sem data na campanha, premios seguem o proximo dia de envio configurado.
-- O relatorio continua filtrando a data real do item, sem ocultar pendencias.
begin;
-- A funcao tambem e chamada por rotinas com search_path vazio.
create or replace function public.next_shipping_date(p_date date)
returns date language sql stable set search_path='' as $$
 select p_date+case when (w-extract(dow from p_date)::int+7)%7=0 then 7
 else (w-extract(dow from p_date)::int+7)%7 end
 from(select coalesce((select shipping_weekday from public.app_settings where id=true),2)::int w)settings;
$$;
create or replace function public.materialize_raffle_award(p_prize uuid,p_order uuid,p_number integer,p_note text default null,p_evidence text default null)
returns void language plpgsql security definer set search_path='' as $$
declare p public.raffle_prizes%rowtype; o public.raffle_orders%rowtype; c public.raffle_campaigns%rowtype; lid uuid;
begin
 select * into p from public.raffle_prizes where id=p_prize;
 select * into o from public.raffle_orders where id=p_order;
 select * into c from public.raffle_campaigns where id=p.campaign_id;
 if o.status<>'paid' or o.campaign_id<>p.campaign_id or not p_number=any(o.numbers) then raise exception 'Cota sem pagamento confirmado.'; end if;
 if exists(select 1 from public.raffle_awards where prize_id=p.id) then return; end if;
 -- Preserva a data explicita; sem ela aplica a mesma agenda semanal dos lotes.
 insert into public.logistics_pending(customer_id,title,quantity,reason,shipping_date,created_by,source_kind)
 values(o.customer_id,left(p.title,160),1,'Rifa: '||c.title||' · Cota '||lpad(p_number::text,greatest(3,length((c.total_numbers-1)::text)),'0'),
 coalesce(c.shipping_date,public.next_shipping_date((now() at time zone 'America/Sao_Paulo')::date)),c.created_by,'raffle') returning id into lid;
 insert into public.raffle_awards(prize_id,campaign_id,order_id,customer_id,number,logistics_id,result_note,evidence_url)
 values(p.id,c.id,o.id,o.customer_id,p_number,lid,p_note,p_evidence);
end; $$;
revoke all on function public.materialize_raffle_award(uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;

-- Repara somente o caso observado em 19/11: premios ainda nao separados,
-- sem etiqueta, de campanha sem previsao e com a data automatica da conquista.
-- Datas escolhidas manualmente e qualquer item ja separado ficam preservados.
update public.logistics_pending p
set shipping_date=public.next_shipping_date((p.created_at at time zone 'America/Sao_Paulo')::date)
from public.raffle_awards a join public.raffle_campaigns c on c.id=a.campaign_id
join public.raffle_orders o on o.id=a.order_id
where a.logistics_id=p.id and c.shipping_date is null and o.status='paid'
 and p.source_kind='raffle' and p.cancelled_at is null and p.moved_at is null and p.shipment_id is null
 and p.updated_at=p.created_at
 and p.shipping_date=date '2026-11-19'
 and p.shipping_date=(p.created_at at time zone 'America/Sao_Paulo')::date;
commit;
