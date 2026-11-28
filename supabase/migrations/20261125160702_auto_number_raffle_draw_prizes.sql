CREATE OR REPLACE FUNCTION public.manage_raffle(p_campaign uuid, p_action text, p_title text DEFAULT NULL::text, p_quantity integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.raffle_campaigns%rowtype; n integer; selected integer[]; v_id uuid; prize_count integer; prize_position integer; unnumbered record; prize_name text; prize_label text;
begin
 if not public.has_staff_write() then raise exception 'Acesso negado.' using errcode='42501'; end if;
 select * into c from public.raffle_campaigns where id=p_campaign for update;
 if not found then raise exception 'Campanha não encontrada.'; end if;
 if p_action in ('main','instant') then
  if c.status not in ('draft','paused') then raise exception 'Pause a campanha antes de adicionar prêmios.'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 160 or p_quantity is null or p_quantity not between 1 and 100 then raise exception 'Revise o prêmio e a quantidade.'; end if;
  if (select count(*) from public.raffle_prizes where campaign_id=c.id)+p_quantity>200 then raise exception 'Limite de 200 prêmios por campanha.'; end if;
  if p_action='instant' then
   select array_agg(x.number) into selected from (select g as number from generate_series(0,c.total_numbers-1) g
    where not exists(select 1 from public.raffle_allocations a where a.campaign_id=c.id and a.number=g)
    and not exists(select 1 from public.raffle_prizes p where p.campaign_id=c.id and p.number=g)
    order by gen_random_uuid() limit p_quantity) x;
   if coalesce(cardinality(selected),0)<>p_quantity then raise exception 'Não há cotas livres suficientes.'; end if;
   foreach n in array selected loop insert into public.raffle_prizes(campaign_id,title,kind,number) values(c.id,btrim(p_title),'instant',n); end loop;
  else
   -- Keep established placements and serialize new placements with the campaign lock.
   select count(*), coalesce(max((substring(lower(title) from '^[[:space:]]*([1-9][0-9]{0,2})[[:space:]]*[º°ª]?[[:space:]]*pr[eê]mio\y'))::integer), 0)
   into prize_count, prize_position
   from public.raffle_prizes where campaign_id=c.id and kind='main';

   prize_name := btrim(regexp_replace(btrim(p_title), '^[[:space:]]*([1-9][0-9]{0,2})[[:space:]]*[º°ª]?[[:space:]]*pr[eê]mio\y[[:space:]:.\-–—]*', '', 'i'));
   if prize_name='' then raise exception 'Informe o nome do prêmio.'; end if;

   if prize_count+p_quantity>1 then
    for unnumbered in
     select id,title from public.raffle_prizes
     where campaign_id=c.id and kind='main' and title !~* '^[[:space:]]*([1-9][0-9]{0,2})[[:space:]]*[º°ª]?[[:space:]]*pr[eê]mio\y'
     order by id
    loop
     prize_position := prize_position+1;
     prize_label := prize_position || 'º prêmio — ' || unnumbered.title;
     if length(prize_label)>160 then raise exception 'O nome de um prêmio é longo demais para incluir a colocação.'; end if;
     update public.raffle_prizes set title=prize_label where id=unnumbered.id;
    end loop;
   end if;

   for n in 1..p_quantity loop
    prize_position := prize_position+1;
    prize_label := case when prize_count+p_quantity>1 then prize_position || 'º prêmio — ' || prize_name else btrim(p_title) end;
    if length(prize_label)>160 then raise exception 'Reduza o nome do prêmio para incluir a colocação.'; end if;
    insert into public.raffle_prizes(campaign_id,title,kind) values(c.id,prize_label,'main');
   end loop;
  end if;
 elsif p_action='open' then
  if c.status not in ('draft','paused') then raise exception 'Campanha indisponível.'; end if;
  if not exists(select 1 from public.raffle_prizes where campaign_id=c.id and kind='main') then raise exception 'Cadastre o prêmio principal antes de publicar.'; end if;
  update public.raffle_campaigns set status='open' where id=c.id;
 elsif p_action='pause' and c.status='open' then update public.raffle_campaigns set status='paused' where id=c.id;
 elsif p_action='close' then
  if exists(select 1 from public.raffle_orders where campaign_id=c.id and status in ('creating','pending','review')) then raise exception 'Resolva os pagamentos abertos antes de encerrar.'; end if;
  if exists(select 1 from public.raffle_prizes p where p.campaign_id=c.id and p.kind='main' and not exists(select 1 from public.raffle_awards a where a.prize_id=p.id)) then raise exception 'Registre os vencedores antes de encerrar.'; end if;
  update public.raffle_campaigns set status='closed' where id=c.id;
 else raise exception 'Ação inválida.'; end if;
 insert into public.raffle_events(campaign_id,actor,action) values(c.id,auth.uid(),p_action);
end; $function$;
