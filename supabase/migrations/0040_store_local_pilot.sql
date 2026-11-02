-- Piloto local: somente o servidor privilegiado pode chamar esta função.
-- Não abre a loja globalmente. O estado temporário nunca é confirmado no banco.
begin;
create function public.run_local_store_pilot(p_customer uuid,p_operation text,p_request_key uuid,p_items jsonb default null,p_template uuid default null,p_voucher uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare subject uuid;previous_enabled boolean;result uuid;previous_sub text:=current_setting('request.jwt.claim.sub',true);previous_claims text:=current_setting('request.jwt.claims',true);
begin
 if p_operation not in('checkout','voucher') or p_request_key is null then raise exception 'Operação de teste inválida.';end if;
 select auth_user_id into subject from public.customers where id=p_customer;
 if subject is null then raise exception 'Cliente de teste sem conta de acesso.';end if;
 select purchases_enabled into previous_enabled from public.store_commerce_settings where id for update;
 if not found then raise exception 'Configuração da loja indisponível.';end if;
 perform set_config('request.jwt.claim.sub',subject::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
 if public.current_customer_id() is distinct from p_customer then raise exception 'Identidade de teste inválida.';end if;
 update public.store_commerce_settings set purchases_enabled=true where id;
 if p_operation='checkout' then result:=public.checkout_store_cart_v2(p_request_key,p_items,p_voucher);
 else result:=public.redeem_store_voucher(p_template,p_request_key);end if;
 update public.store_commerce_settings set purchases_enabled=previous_enabled where id;
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 return result;
 -- Qualquer exceção desfaz a operação e a alteração temporária em uma transação.
end $$;
revoke all on function public.run_local_store_pilot(uuid,text,uuid,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.run_local_store_pilot(uuid,text,uuid,jsonb,uuid,uuid) to service_role;
commit;
