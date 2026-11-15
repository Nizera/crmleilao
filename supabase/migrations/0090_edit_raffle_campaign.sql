begin;
create function public.edit_raffle_campaign(p_campaign uuid,p_data jsonb,p_expected jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare c public.raffle_campaigns%rowtype; key text; commercial_change boolean; structural_change boolean;
begin
 if public.has_staff_write() is not true then raise exception 'Acesso negado.' using errcode='42501';end if;
 select * into c from public.raffle_campaigns where id=p_campaign for update;
 if not found or c.archived_at is not null or c.status not in('draft','paused') then raise exception 'Edite um rascunho ou pause a campanha antes de alterar.';end if;
 foreach key in array array['title','description','total_numbers','unit_price','selection_mode','draw_method','draw_rules','shipping_date','image_url','hide_winning_numbers','min_quantity','max_quantity','price_tiers'] loop
  if not coalesce(p_expected ? key,false) or (to_jsonb(c)->key) is distinct from (p_expected->key) then raise exception 'A campanha mudou. Atualize a página antes de salvar.';end if;
 end loop;
 if p_data is null or jsonb_typeof(p_data)<>'object' or not(p_data ?& array['title','description','total_numbers','unit_price','selection_mode','draw_method','draw_rules','shipping_date','hide_winning_numbers','min_quantity','max_quantity']) then raise exception 'Dados da campanha incompletos.';end if;
 if length(btrim(p_data->>'title')) not between 3 and 160 or length(btrim(p_data->>'description')) not between 10 and 6000
  or length(btrim(p_data->>'draw_rules')) not between 10 and 2000 then raise exception 'Revise o título, a descrição e as regras.';end if;
 commercial_change:=c.unit_price is distinct from (p_data->>'unit_price')::numeric or c.min_quantity is distinct from (p_data->>'min_quantity')::int or c.max_quantity is distinct from (p_data->>'max_quantity')::int;
 structural_change:=c.total_numbers is distinct from (p_data->>'total_numbers')::int or c.draw_method is distinct from p_data->>'draw_method' or c.hide_winning_numbers is distinct from (p_data->>'hide_winning_numbers')::boolean;
 if commercial_change and exists(select 1 from public.raffle_orders where campaign_id=c.id and status in('creating','pending','review')) then raise exception 'Resolva as reservas pendentes ou em análise antes de alterar preços e limites.';end if;
 if structural_change and exists(select 1 from public.raffle_orders where campaign_id=c.id) then raise exception 'Quantidade de cotas, método de apuração e ocultação dos números só podem mudar antes da primeira reserva.';end if;
 if (commercial_change or structural_change) and exists(select 1 from public.raffle_awards a join public.raffle_prizes p on p.id=a.prize_id where a.campaign_id=c.id and p.kind='main') then raise exception 'A apuração já começou. Duplique a campanha para criar outra configuração.';end if;
 if exists(select 1 from public.raffle_prizes where campaign_id=c.id and kind='instant' and number>=(p_data->>'total_numbers')::int) then raise exception 'Há cotas premiadas fora da nova quantidade. Revise os prêmios antes de reduzir.';end if;
 update public.raffle_campaigns set title=btrim(p_data->>'title'),description=btrim(p_data->>'description'),total_numbers=(p_data->>'total_numbers')::int,
  unit_price=(p_data->>'unit_price')::numeric,selection_mode=p_data->>'selection_mode',draw_method=p_data->>'draw_method',draw_rules=btrim(p_data->>'draw_rules'),
  shipping_date=nullif(p_data->>'shipping_date','')::date,hide_winning_numbers=(p_data->>'hide_winning_numbers')::boolean,
  min_quantity=(p_data->>'min_quantity')::int,max_quantity=(p_data->>'max_quantity')::int where id=c.id;
 -- Revalida as promoções existentes contra o novo preço/limite na mesma transação.
 perform public.set_raffle_price_tiers(c.id,c.price_tiers,c.price_tiers);
 insert into public.raffle_events(campaign_id,actor,action) values(c.id,auth.uid(),'Dados da campanha editados. Reservas, valores pagos e prêmios já conquistados preservados.');
end;$$;
revoke all on function public.edit_raffle_campaign(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.edit_raffle_campaign(uuid,jsonb,jsonb) to authenticated;
commit;
