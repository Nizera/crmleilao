begin;

alter table public.raffle_campaigns add column duplication_key uuid unique;

create function public.duplicate_raffle_campaign(p_source uuid, p_request uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.raffle_campaigns%rowtype; destination uuid; owner_id uuid;
begin
 if public.has_staff_write() is not true then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_request is null then raise exception 'Identificador da duplicação obrigatório.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text, 0));
 select id,created_by into destination,owner_id from public.raffle_campaigns where duplication_key=p_request;
 if found then
  if owner_id is distinct from auth.uid() then raise exception 'Acesso negado.' using errcode='42501'; end if;
  return destination;
 end if;
 select * into c from public.raffle_campaigns where id=p_source for share;
 if not found or c.status<>'closed' then raise exception 'Somente campanhas encerradas ou apuradas podem ser duplicadas.'; end if;
 insert into public.raffle_campaigns(title,description,total_numbers,unit_price,selection_mode,draw_method,draw_rules,
   shipping_date,image_url,image_urls,hide_winning_numbers,min_quantity,max_quantity,price_tiers,status,created_by,duplication_key)
 values(left(c.title,152)||' (cópia)',c.description,c.total_numbers,c.unit_price,c.selection_mode,c.draw_method,c.draw_rules,
   null,c.image_url,c.image_urls,c.hide_winning_numbers,c.min_quantity,c.max_quantity,c.price_tiers,'draft',auth.uid(),p_request)
 returning id into destination;
 insert into public.raffle_prizes(campaign_id,title,kind,number,image_urls)
 select destination,title,'main',null,image_urls from public.raffle_prizes where campaign_id=c.id and kind='main';
 insert into public.raffle_events(campaign_id,actor,action)
 values(destination,auth.uid(),'Rascunho duplicado da campanha '||c.id||'. Sem reservas, cotas premiadas, pagamentos ou ganhadores.');
 return destination;
end; $$;
revoke all on function public.duplicate_raffle_campaign(uuid,uuid) from public,anon;
grant execute on function public.duplicate_raffle_campaign(uuid,uuid) to authenticated;
commit;
