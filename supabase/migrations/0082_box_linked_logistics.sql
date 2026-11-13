-- Permite registrar a separação física de itens já incluídos na etiqueta.
-- Não altera o conteúdo, o valor declarado ou o vínculo do pacote.
begin;
create or replace function public.handle_logistics_pending(p_id uuid,p_action text,p_day date default null)
returns void language plpgsql security definer set search_path='' as $$
declare issue public.logistics_pending%rowtype; customer uuid;
begin
 if public.has_staff_write() is not true then raise exception 'Acesso negado.' using errcode='42501'; end if;
 select customer_id into customer from public.logistics_pending where id=p_id;
 if not found then raise exception 'Pendência não encontrada.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(customer::text,0));
 select * into issue from public.logistics_pending where id=p_id for update;
 if issue.source_kind<>'replacement' then raise exception 'Este item é um prêmio de rifa. Gerencie em Rifa > Prêmios e separação.'; end if;
 if issue.shipment_id is not null then
   if p_action <> 'box' then raise exception 'A pendência já está vinculada a uma etiqueta. Cancele a etiqueta antes de alterar.'; end if;
   if not exists(select 1 from public.shipments s where s.id=issue.shipment_id and s.customer_id=issue.customer_id and s.status in ('pending','released','posted','delivered')) then
     raise exception 'Confira a situação da etiqueta antes de registrar a separação.';
   end if;
 end if;
 if issue.cancelled_at is not null then raise exception 'Esta pendência foi cancelada.'; end if;
 if p_action='box' then
   if issue.moved_at is not null then return; end if;
   update public.logistics_pending set moved_at=now(),moved_by=auth.uid() where id=issue.id;
 elsif p_action='reopen' then
   update public.logistics_pending set moved_at=null,moved_by=null where id=issue.id;
 elsif p_action='cancel' then
   update public.logistics_pending set cancelled_at=now(),cancelled_by=auth.uid() where id=issue.id;
 elsif p_action='reschedule' and p_day is not null then
   update public.logistics_pending set shipping_date=p_day where id=issue.id;
 else raise exception 'Ação inválida.'; end if;
end; $$;
revoke all on function public.handle_logistics_pending(uuid,text,date) from public,anon;
grant execute on function public.handle_logistics_pending(uuid,text,date) to authenticated;

create or replace function public.box_raffle_award(p_issue uuid,p_value numeric) returns void
language plpgsql security definer set search_path='' as $$
declare customer uuid; issue public.logistics_pending%rowtype;
begin
 if public.has_staff_write() is not true then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_value is null or p_value<0 or p_value>100000 or p_value<>round(p_value,2) then raise exception 'Valor declarado inválido.'; end if;
 select customer_id into customer from public.logistics_pending where id=p_issue;
 if customer is null then raise exception 'Prêmio não encontrado.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(customer::text,0));
 select * into issue from public.logistics_pending where id=p_issue for update;
 if issue.source_kind<>'raffle' or issue.cancelled_at is not null then raise exception 'Prêmio indisponível para separação.'; end if;
 if not exists(select 1 from public.raffle_awards a join public.raffle_orders o on o.id=a.order_id where a.logistics_id=p_issue and o.status='paid') then raise exception 'Confira o pagamento do prêmio antes da separação.'; end if;
 if issue.shipment_id is not null then
   if not exists(select 1 from public.shipments s where s.id=issue.shipment_id and s.customer_id=issue.customer_id and s.status in ('pending','released','posted','delivered')) then
     raise exception 'Confira a situação da etiqueta antes de registrar a separação.';
   end if;
   if issue.moved_at is not null then return; end if;
   update public.logistics_pending set moved_at=now(),moved_by=auth.uid() where id=p_issue;
   return;
 end if;
 if issue.moved_at is not null and issue.shipping_declared_value>0 then return; end if;
 update public.logistics_pending set shipping_declared_value=p_value,moved_at=coalesce(moved_at,now()),moved_by=auth.uid() where id=p_issue;
end; $$;

revoke all on function public.box_raffle_award(uuid,numeric) from public,anon;
grant execute on function public.box_raffle_award(uuid,numeric) to authenticated;
commit;
