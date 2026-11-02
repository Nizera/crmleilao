-- Galeria da campanha; a capa antiga continua funcionando sem migração dos dados.
begin;
alter table public.raffle_campaigns add column image_urls text[] not null default '{}'
 check(cardinality(image_urls)<=6);

create function public.set_raffle_photos(p_campaign uuid,p_urls text[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.has_staff_write() then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_urls is null or cardinality(p_urls)>6 or exists(select 1 from unnest(p_urls) u where u is null or length(u)>2000 or u !~ '^https://[^/]+/.+') then
  raise exception 'Informe até seis imagens HTTPS válidas.';
 end if;
 perform 1 from public.raffle_campaigns where id=p_campaign for update;
 if not found then raise exception 'Campanha não encontrada.'; end if;
 update public.raffle_campaigns set image_urls=p_urls,image_url=coalesce(p_urls[1],'') where id=p_campaign;
 insert into public.raffle_events(campaign_id,actor,action) values(p_campaign,auth.uid(),'Fotos da campanha atualizadas');
end; $$;
revoke all on function public.set_raffle_photos(uuid,text[]) from public,anon;
grant execute on function public.set_raffle_photos(uuid,text[]) to authenticated;
commit;
