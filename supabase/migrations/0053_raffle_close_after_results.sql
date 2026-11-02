-- Encerramento atômico após o último prêmio principal; preserva o histórico.
begin;
create or replace function public.record_raffle_winner(p_prize uuid,p_number integer,p_note text,p_evidence text) returns void language plpgsql security definer set search_path='' as $$
declare p public.raffle_prizes%rowtype; oid uuid; cid uuid;
begin
 if not public.has_staff_write() then raise exception 'Acesso negado.' using errcode='42501'; end if;
 select campaign_id into cid from public.raffle_prizes where id=p_prize;
 perform 1 from public.raffle_campaigns where id=cid and status='paused' for update;
 if not found then raise exception 'Pause a campanha antes de registrar o resultado.'; end if;
 if p_note is null or length(btrim(p_note)) not between 10 and 2000 or p_evidence is null or p_evidence not like 'https://%' or length(p_evidence)>2000 then raise exception 'Informe as regras aplicadas e o link HTTPS do resultado.'; end if;
 if exists(select 1 from public.raffle_orders where campaign_id=cid and status in ('creating','pending','review')) then raise exception 'Resolva as reservas abertas antes da apuração.'; end if;
 select * into p from public.raffle_prizes where id=p_prize and kind='main';
 if not found or exists(select 1 from public.raffle_awards where prize_id=p.id) then raise exception 'Prêmio indisponível ou resultado já registrado.'; end if;
 select a.order_id into oid from public.raffle_allocations a join public.raffle_orders o on o.id=a.order_id where a.campaign_id=cid and a.number=p_number and o.status='paid';
 if oid is null then raise exception 'Esta cota não possui pagamento confirmado.'; end if;
 perform public.materialize_raffle_award(p.id,oid,p_number,p_note,p_evidence);
 insert into public.raffle_events(campaign_id,actor,action) values(cid,auth.uid(),'Resultado registrado: cota '||p_number);
 -- Encerra somente depois de atribuir todos os prêmios principais.
 if not exists(select 1 from public.raffle_prizes rp where rp.campaign_id=cid and rp.kind='main' and not exists(select 1 from public.raffle_awards a where a.prize_id=rp.id)) then
  update public.raffle_campaigns set status='closed' where id=cid;
  insert into public.raffle_events(campaign_id,actor,action) values(cid,auth.uid(),'Campanha encerrada após apuração completa');
 end if;
end; $$;
commit;
