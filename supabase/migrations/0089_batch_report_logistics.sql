begin;
-- Uma transação para a seleção inteira. Mantém a separação independente da etiqueta
-- e reutiliza as validações de pagamento, estoque e propriedade existentes.
create function public.move_report_items_to_boxes(p_lot_ids uuid[],p_issue_ids uuid[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare customer uuid; issue record; moved_lots integer:=0; moved_issues integer:=0;
begin
 if public.has_staff_write() is not true then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_lot_ids is null or p_issue_ids is null or cardinality(p_lot_ids)+cardinality(p_issue_ids) not between 1 and 100
  or array_position(p_lot_ids,null) is not null or array_position(p_issue_ids,null) is not null
  or cardinality(p_lot_ids)<>(select count(distinct x) from unnest(p_lot_ids) x)
  or cardinality(p_issue_ids)<>(select count(distinct x) from unnest(p_issue_ids) x) then raise exception 'Selecione de 1 a 100 itens diferentes.';end if;
 if (select count(*) from public.lots where id=any(p_lot_ids))<>cardinality(p_lot_ids)
  or (select count(*) from public.logistics_pending where id=any(p_issue_ids))<>cardinality(p_issue_ids) then raise exception 'Um item não foi encontrado. Atualize o relatório.';end if;
 for customer in select customer_id from public.lots where id=any(p_lot_ids)
  union select customer_id from public.logistics_pending where id=any(p_issue_ids) order by 1 loop
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(customer::text,0));
 end loop;
 if cardinality(p_lot_ids)>0 then moved_lots:=public.move_lots_to_customer_boxes(p_lot_ids);end if;
 for issue in select * from public.logistics_pending where id=any(p_issue_ids) order by customer_id,id for update loop
  if issue.source_kind='raffle' then
   -- Preserva qualquer valor já cadastrado; não solicita valor para separar.
   perform public.box_raffle_award(issue.id,coalesce(issue.shipping_declared_value,0));
  elsif issue.source_kind='replacement' then
   perform public.handle_logistics_pending(issue.id,'box',null);
  else raise exception 'Tipo de item não disponível para separação.';end if;
  if issue.moved_at is null then moved_issues:=moved_issues+1;end if;
 end loop;
 return jsonb_build_object('lots',moved_lots,'logistics',moved_issues,'moved',moved_lots+moved_issues);
end; $$;
revoke all on function public.move_report_items_to_boxes(uuid[],uuid[]) from public,anon;
grant execute on function public.move_report_items_to_boxes(uuid[],uuid[]) to authenticated;
commit;
