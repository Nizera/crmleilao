CREATE OR REPLACE FUNCTION public.box_store_order(p_order_id uuid, p_note text DEFAULT ''::text, p_declared_value numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.store_orders%rowtype;cash_value numeric;has_coins boolean;
begin
 if not public.has_staff_write() then raise exception 'Acesso negado.';end if;
 select * into o from public.store_orders where id=p_order_id for update;
 if not found or o.payment_status<>'paid' or o.fulfillment_status<>'processing' then raise exception 'Pedido indisponível para separação.';end if;
 if o.shipment_id is not null then
  if not exists(select 1 from public.shipments s where s.id=o.shipment_id
    and s.customer_id=o.customer_id and s.status in ('pending','released') and s.posted_at is null)
    or coalesce(o.shipping_declared_value,0)<=0 then
   raise exception 'Pedido indisponível para separação.';
  end if;
  perform public.handle_store_order(p_order_id,'boxed',left(coalesce(p_note,''),500));
  return;
 end if;
 if o.boxed_at is not null and o.shipping_declared_value is not null then return;end if;
 select coalesce(sum(quantity*unit_cash),0),coalesce(bool_or(unit_coins>0),false) into cash_value,has_coins from public.store_order_items where order_id=o.id and delivery_kind='physical';
 if not exists(select 1 from public.store_order_items where order_id=o.id and delivery_kind='physical') then raise exception 'Pedido sem produto físico.';end if;
 if has_coins then
  if p_declared_value is null or p_declared_value<=0 or p_declared_value>100000 or p_declared_value<>round(p_declared_value,2) then raise exception 'Informe o valor declarado em reais dos produtos físicos pagos em Caracoins.';end if;
 else p_declared_value:=cash_value;end if;
 if p_declared_value<=0 then raise exception 'Informe o valor declarado dos produtos.';end if;
 update public.store_orders set shipping_declared_value=p_declared_value where id=o.id;
 if o.boxed_at is null then perform public.handle_store_order(p_order_id,'boxed',left(coalesce(p_note,''),500));end if;
end $function$
;
