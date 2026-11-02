-- Requer a estrutura de rifas (0043) já aplicada.
begin;
alter table public.raffle_campaigns alter column shipping_date drop not null;

create or replace function public.materialize_raffle_award(p_prize uuid,p_order uuid,p_number integer,p_note text default null,p_evidence text default null)
returns void language plpgsql security definer set search_path='' as $$
declare p public.raffle_prizes%rowtype; o public.raffle_orders%rowtype; c public.raffle_campaigns%rowtype; lid uuid;
begin
 select * into p from public.raffle_prizes where id=p_prize;
 select * into o from public.raffle_orders where id=p_order;
 select * into c from public.raffle_campaigns where id=p.campaign_id;
 if o.status<>'paid' or o.campaign_id<>p.campaign_id or not p_number=any(o.numbers) then raise exception 'Cota sem pagamento confirmado.'; end if;
 if exists(select 1 from public.raffle_awards where prize_id=p.id) then return; end if;
 -- Sem previsão na campanha, o dia da conquista é a referência operacional
 -- da fila de separação. A previsão da campanha continua em branco.
 insert into public.logistics_pending(customer_id,title,quantity,reason,shipping_date,created_by,source_kind)
 values(o.customer_id,left(p.title,160),1,'Rifa: '||c.title||' · Cota '||lpad(p_number::text,greatest(3,length((c.total_numbers-1)::text)),'0'),
 coalesce(c.shipping_date,(now() at time zone 'America/Sao_Paulo')::date),c.created_by,'raffle') returning id into lid;
 insert into public.raffle_awards(prize_id,campaign_id,order_id,customer_id,number,logistics_id,result_note,evidence_url)
 values(p.id,c.id,o.id,o.customer_id,p_number,lid,p_note,p_evidence);
end; $$;
revoke all on function public.materialize_raffle_award(uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
commit;
