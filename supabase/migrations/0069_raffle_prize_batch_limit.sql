-- Amplia os tipos por cadastro, preservando os limites totais e validações.
begin;
create or replace function public.add_raffle_instant_prizes(p_campaign uuid,p_key uuid,p_items jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare c public.raffle_campaigns%rowtype; item jsonb; ns integer[]; total integer:=0; qty integer; n integer; urls text[];
begin
 if public.has_staff_write() is not true then raise exception 'Acesso negado.' using errcode='42501';end if;
 select * into c from public.raffle_campaigns where id=p_campaign for update;
 if not found then raise exception 'Campanha não encontrada.';end if;
 if p_key is null then raise exception 'Identificador obrigatório.';end if;
 if exists(select 1 from public.raffle_events where campaign_id=c.id and action='instant_batch:'||p_key::text) then return;end if;
 if c.status not in ('draft','paused') or c.archived_at is not null then raise exception 'Pause a campanha para adicionar cotas premiadas.';end if;
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Lista inválida.';end if;
 if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Adicione de 1 a 100 tipos de prêmio.';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item->'title') is distinct from 'string' or length(btrim(item->>'title')) not between 1 and 160 then raise exception 'Informe o nome de cada prêmio.';end if;
  if jsonb_typeof(item->'quantity') is distinct from 'number' or (item->>'quantity')::numeric<>trunc((item->>'quantity')::numeric) then raise exception 'Quantidade inválida.';end if;
  qty:=(item->>'quantity')::integer;
  if qty not between 1 and 100 then raise exception 'Quantidade deve ser entre 1 e 100.';end if;
  total:=total+qty;
  if jsonb_typeof(item->'image_urls') is distinct from 'array' then raise exception 'Fotos inválidas.';end if;
  if jsonb_array_length(item->'image_urls')>4 or exists(select 1 from jsonb_array_elements(item->'image_urls') u where jsonb_typeof(u) is distinct from 'string' or length(u#>>'{}')>2000 or left(u#>>'{}',85)<>'https://hpfiuyzdyojnqfkdqyql.supabase.co/storage/v1/object/public/lot-images/raffles/') then raise exception 'Use até quatro fotos enviadas pelo app.';end if;
 end loop;
 if total>100 or total+(select count(*) from public.raffle_prizes where campaign_id=c.id)>200 then raise exception 'Limite de 100 novos prêmios e 200 por campanha.';end if;
 select array_agg(number) into ns from(select g number from generate_series(0,c.total_numbers-1) g where not exists(select 1 from public.raffle_allocations a where a.campaign_id=c.id and a.number=g) and not exists(select 1 from public.raffle_prizes p where p.campaign_id=c.id and p.number=g) order by gen_random_uuid() limit total) available;
 if coalesce(cardinality(ns),0)<>total then raise exception 'Não há cotas livres suficientes.';end if;
 n:=1;
 for item in select value from jsonb_array_elements(p_items) loop
  select coalesce(array_agg(value),'{}'::text[]) into urls from jsonb_array_elements_text(item->'image_urls');
  for qty in 1..(item->>'quantity')::integer loop
   insert into public.raffle_prizes(campaign_id,title,kind,number,image_urls) values(c.id,btrim(item->>'title'),'instant',ns[n],urls);n:=n+1;
  end loop;
 end loop;
 insert into public.raffle_events(campaign_id,actor,action) values(c.id,auth.uid(),'instant_batch:'||p_key::text);
end $$;
revoke all on function public.add_raffle_instant_prizes(uuid,uuid,jsonb) from public,anon;
grant execute on function public.add_raffle_instant_prizes(uuid,uuid,jsonb) to authenticated;
commit;
