begin;
create function public.recover_cancelled_lots_batch(p_ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare target_customer uuid; found_count integer; affected integer;
begin
 if public.has_staff_write() is not true then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_ids is null or cardinality(p_ids) not between 1 and 200 or array_position(p_ids,null) is not null
   or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x) then raise exception 'Selecione de 1 a 200 lotes diferentes.'; end if;
 -- Trava todos em ordem estável e valida a seleção inteira antes de alterar qualquer lote.
 perform 1 from public.lots where id=any(p_ids) order by id for update;
 select count(*),min(customer_id::text)::uuid into found_count,target_customer from public.lots where id=any(p_ids);
 if found_count<>cardinality(p_ids) then raise exception 'Um lote não foi encontrado. Atualize a seleção.'; end if;
 if (select count(distinct customer_id) from public.lots where id=any(p_ids))<>1 then raise exception 'Selecione somente lotes do mesmo cliente.'; end if;
 if exists(select 1 from public.lots where id=any(p_ids) and
   (status<>'cancelled' or charge_id is not null or paid_at is not null or shipped_at is not null)) then
   raise exception 'Todos devem estar cancelados, sem cobrança vinculada, pagamento ou envio. Nenhum lote foi alterado.';
 end if;
 if exists(select 1 from public.shipment_lots where lot_id=any(p_ids)) or
    exists(select 1 from public.lot_items where lot_id=any(p_ids) and applied) then
   raise exception 'Há lote vinculado a envio ou com estoque movimentado. Confira antes de recuperar. Nenhum lote foi alterado.';
 end if;
 update public.lots set status='pending_payment',paid_at=null,shipped_at=null,moved_at=null,pix_paused_at=null,
   payment_due_at=case when arremate_value>0 then now()+interval '24 hours' else null end,
   payment_expired_at=null,payment_reminded_at=null,payment_last_warning_at=null,payment_expiry_retry_at=null
 where id=any(p_ids);
 get diagnostics affected=row_count;
 return affected;
end; $$;
revoke all on function public.recover_cancelled_lots_batch(uuid[]) from public,anon;
grant execute on function public.recover_cancelled_lots_batch(uuid[]) to authenticated;
commit;
