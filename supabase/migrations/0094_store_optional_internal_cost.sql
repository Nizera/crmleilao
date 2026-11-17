-- Internal cost is optional; NULL remains unknown, never converted to zero.
CREATE OR REPLACE FUNCTION public.set_store_commerce_enabled(p_enabled boolean, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 if not public.is_owner() then raise exception 'Acesso negado.';end if;
 if p_enabled is null or length(trim(coalesce(p_note,''))) not between 5 and 500 then raise exception 'Informe o motivo da mudança.';end if;
 perform 1 from public.store_commerce_settings where id for update;
 if p_enabled then
  if not exists(select 1 from public.loyalty_settings where id and active) then raise exception 'Ative o programa antes de abrir as compras.';end if;
  if exists(select 1 from public.loyalty_rewards where active and not archived and(mixed_cash_price is not null or mixed_points_cost is not null or(cash_price is not null and points_cost is not null))) then raise exception 'Revise os produtos antigos com preços combinados antes de abrir.';end if;
  if not exists(select 1 from public.loyalty_rewards where active and not archived and(cash_price>0 or points_cost>0) and(stock is null or stock>0)) then raise exception 'Cadastre um produto disponível com preço antes de abrir.';end if;
 end if;
 update public.store_commerce_settings set purchases_enabled=p_enabled where id;
 insert into public.store_commerce_events(enabled,note,actor) values(p_enabled,trim(p_note),auth.uid());
end $function$;

CREATE OR REPLACE FUNCTION public.validate_loyalty_reward()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.active and (
    (new.points_cost is null and new.cash_price is null and new.mixed_cash_price is null)) then
    raise exception 'Para publicar, informe ao menos uma modalidade de preço.';
  end if;
  if exists (select 1 from public.loyalty_settings where id = true and active)
     and (not new.active or 
       (new.points_cost is null and new.cash_price is null and new.mixed_cash_price is null))
     and not exists (select 1 from public.loyalty_rewards where active and id <> new.id
       and (points_cost is not null or cash_price is not null or mixed_cash_price is not null)) then
    raise exception 'Desative o programa antes de remover o último produto publicado.';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$function$;
