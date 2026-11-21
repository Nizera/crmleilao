begin;
create or replace function public.set_raffle_buyer_bonus(p_campaign uuid,p_title text,p_kind text,p_amount numeric,p_expected integer)
returns void language plpgsql security definer set search_path='' as $$
declare c public.raffle_campaigns%rowtype; b public.raffle_buyer_bonus%rowtype;
begin
 if public.has_staff_write() is not true or auth.uid() is null then raise exception 'Acesso negado.' using errcode='42501';end if;
 select * into c from public.raffle_campaigns where id=p_campaign for update;
 if not found or c.archived_at is not null or c.status not in ('draft','paused','open') then raise exception 'O bônus só pode ser editado antes do encerramento da campanha.';end if;
 if exists(select 1 from public.raffle_buyer_results where campaign_id=c.id) then raise exception 'O bônus já foi apurado. O prêmio conquistado não pode ser alterado.';end if;
 select * into b from public.raffle_buyer_bonus where campaign_id=c.id;
 if coalesce(b.version,0) is distinct from p_expected then raise exception 'O bônus mudou. Atualize a página.';end if;
 if length(btrim(coalesce(p_title,''))) not between 3 and 120 or p_kind is null or p_kind not in ('physical','pix','voucher')
  or (p_kind<>'physical' and (p_amount is null or p_amount<=0 or p_amount>100000)) then raise exception 'Confira o prêmio e o valor.';end if;
 insert into public.raffle_buyer_bonus(campaign_id,title,delivery_kind,amount) values(c.id,btrim(p_title),p_kind,case when p_kind='physical' then null else round(p_amount,2) end)
 on conflict(campaign_id) do update set title=excluded.title,delivery_kind=excluded.delivery_kind,amount=excluded.amount,version=raffle_buyer_bonus.version+1;
 insert into public.raffle_events(campaign_id,actor,action) values(c.id,auth.uid(),
  'Bônus de maior comprador atualizado. Antes: '||coalesce(jsonb_build_object('title',b.title,'kind',b.delivery_kind,'amount',b.amount,'version',b.version)::text,'null')||
  '. Depois: '||jsonb_build_object('title',btrim(p_title),'kind',p_kind,'amount',case when p_kind='physical' then null else round(p_amount,2) end,'version',coalesce(b.version,0)+1)::text||
  '. Reservas e pagamentos preservados; apuração no encerramento.');
end;$$;
revoke all on function public.set_raffle_buyer_bonus(uuid,text,text,numeric,integer) from public,anon;
grant execute on function public.set_raffle_buyer_bonus(uuid,text,text,numeric,integer) to authenticated;
commit;
