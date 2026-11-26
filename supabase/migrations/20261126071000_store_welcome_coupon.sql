begin;

create table public.store_coupons (
  code text primary key check (code ~ '^[A-Z0-9_-]{3,32}$'),
  percent_off integer not null check (percent_off between 1 and 99),
  active boolean not null default false
);
alter table public.store_coupons enable row level security;
revoke all on public.store_coupons from anon, authenticated;
grant select, update on public.store_coupons to service_role;

insert into public.store_coupons (code, percent_off, active)
values ('BEMVINDO10', 10, true);

alter table public.store_orders add column coupon_code text references public.store_coupons(code);
create index store_orders_coupon_code_idx on public.store_orders (coupon_code) where coupon_code is not null;

create function public.checkout_store_cart_with_coupon(
  p_request_key uuid, p_items jsonb, p_code text, p_expected_discount numeric
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  customer uuid := public.current_customer_id();
  existing public.store_orders%rowtype;
  coupon public.store_coupons%rowtype;
  order_id uuid;
  subtotal numeric;
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
       or existing.discount_cash is distinct from p_expected_discount then
      raise exception 'Cupom diferente do pedido já criado. Confira seus pedidos.';
    end if;
    return existing.id;
  end if;

  select * into coupon from public.store_coupons
    where code = upper(btrim(p_code)) and active for share;
  if not found then raise exception 'Cupom inválido ou pausado.'; end if;
  order_id := public.checkout_store_cart_cancellable(p_request_key, p_items, null);
  if exists (
    select 1 from public.store_orders
    where customer_id = customer and id <> order_id and
      (paid_at is not null or payment_status in ('paid', 'refunded', 'partially_refunded', 'payment_review'))
  ) then
    raise exception 'Cupom exclusivo para a primeira compra na loja.';
  end if;

  select cash_subtotal into strict subtotal from public.store_orders where id = order_id;
  discount := round(subtotal * coupon.percent_off / 100, 2);
  if discount <= 0 then raise exception 'Cupom aplicável apenas a produtos pagos em reais.'; end if;
  if discount is distinct from p_expected_discount then
    raise exception 'Cupom com desconto atualizado. Confira o valor antes de tentar novamente.';
  end if;
  update public.store_orders
    set coupon_code = coupon.code, discount_cash = discount, cash_total = cash_total - discount
    where id = order_id;
  return order_id;
end $$;
revoke all on function public.checkout_store_cart_with_coupon(uuid,jsonb,text,numeric) from public, anon;
grant execute on function public.checkout_store_cart_with_coupon(uuid,jsonb,text,numeric) to authenticated;

commit;
