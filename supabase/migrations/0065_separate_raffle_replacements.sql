-- Separa apenas a listagem e as ações de reposição; preserva logística e relatórios.
begin;
create or replace view public.logistics_replacement_list with (security_invoker=true) as
select l.* from public.logistics_pending_list l
join public.logistics_pending p on p.id=l.id
where p.source_kind='replacement';
revoke all on public.logistics_replacement_list from public,anon,authenticated;
grant select on public.logistics_replacement_list to authenticated,service_role;
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
 if issue.shipment_id is not null then raise exception 'A pendência já está vinculada a uma etiqueta. Cancele a etiqueta antes de alterar.'; end if;
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


commit;
