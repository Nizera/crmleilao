-- Bloqueio temporário de novas compras no banco, inclusive pelo acesso direto à API.
-- Não altera pedidos, reservas, pagamentos, catálogo ou saldos já existentes.
begin;
alter function public.checkout_store_cart(uuid,jsonb) rename to checkout_store_cart_live;
revoke all on function public.checkout_store_cart_live(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.checkout_store_cart(p_request_key uuid,p_items jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  raise exception 'A loja está em prévia. Compras e resgates ainda não estão disponíveis.';
end; $$;
revoke all on function public.checkout_store_cart(uuid,jsonb) from public,anon,service_role;
grant execute on function public.checkout_store_cart(uuid,jsonb) to authenticated;
commit;
