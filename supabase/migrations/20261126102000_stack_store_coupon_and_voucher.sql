begin;

create function public.checkout_store_cart_with_coupon(
  p_request_key uuid, p_items jsonb, p_code text, p_expected_discount numeric, p_voucher uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  customer uuid := public.current_customer_id();
  existing public.store_orders%rowtype;
  coupon public.store_coupons%rowtype;
  order_id uuid;
  created public.store_orders%rowtype;
  total_due numeric;
  discount numeric;
begin
  if customer is null or p_request_key is null then
    raise exception 'Cliente não autenticado.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(customer::text, 0));
  select * into existing from public.store_orders
    where customer_id = customer and request_key = p_request_key;
  if found then
    if existing.coupon_code is distinct from upper(btrim(p_code))
       or existing.voucher_id is distinct from p_voucher
       or existing.discount_cash is distinct from p_expected_discount then
      raise exception 'Cupom diferente do pedido já criado. Confira seus pedidos.';
    end if;
    return existing.id;
  end if;

  select * into coupon from public.store_coupons
    where code = upper(btrim(p_code)) and active for share;
  if not found then raise exception 'Cupom inválido ou pausado.'; end if;
  order_id := public.checkout_store_cart_cancellable(p_request_key, p_items, p_voucher);
  if exists (
    select 1 from public.store_orders
    where customer_id = customer and id <> order_id and
      (paid_at is not null or payment_status in ('paid', 'refunded', 'partially_refunded', 'payment_review'))
  ) then
    raise exception 'Cupom exclusivo para a primeira compra na loja.';
  end if;

  select * into strict created from public.store_orders where id = order_id for update;
  discount := least(round(created.cash_subtotal * coupon.percent_off / 100, 2),
                    created.cash_subtotal - created.discount_cash);
  if discount <= 0 then raise exception 'Cupom aplicável apenas quando há valor de produtos em reais após o voucher.'; end if;
  if created.discount_cash + discount is distinct from p_expected_discount then
    raise exception 'Cupom com desconto atualizado. Confira o valor antes de tentar novamente.';
  end if;
  total_due := created.cash_total - discount;
  update public.store_orders
    set coupon_code = coupon.code,
        discount_cash = created.discount_cash + discount,
        cash_total = total_due,
        payment_status = case when total_due = 0 then 'paid' else payment_status end,
        paid_at = case when total_due = 0 then now() else paid_at end
    where id = order_id;
  return order_id;
end $$;
revoke all on function public.checkout_store_cart_with_coupon(uuid,jsonb,text,numeric,uuid) from public, anon;
grant execute on function public.checkout_store_cart_with_coupon(uuid,jsonb,text,numeric,uuid) to authenticated;

commit;
