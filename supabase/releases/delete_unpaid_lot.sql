-- Safe deletion of unpaid lots, with stock restoration and a private audit.
-- Requires the current stock reconciler from migration 0083.
begin;
create table public.lot_deletions (
 id uuid primary key default gen_random_uuid(),
 lot_id uuid not null,
 code text not null,
 snapshot jsonb not null,
 items jsonb not null,
 deleted_by uuid references public.admin_profiles(id) on delete set null,
 deleted_at timestamptz not null default now()
);
alter table public.lot_deletions enable row level security;
revoke all on public.lot_deletions from public,anon,authenticated;
grant select on public.lot_deletions to authenticated;
grant all on public.lot_deletions to service_role;
create policy lot_deletions_staff_read on public.lot_deletions for select to authenticated using(public.is_admin());

create function public.delete_unpaid_lot(p_lot uuid,p_expected timestamptz) returns text
language plpgsql security definer set search_path='' as $$
declare l public.lots%rowtype; previous_items jsonb;
begin
 if public.has_staff_write() is not true or auth.uid() is null then raise exception 'Acesso negado.' using errcode='42501';end if;
 select * into l from public.lots where id=p_lot for update;
 if not found then raise exception 'Lote não encontrado ou já excluído.';end if;
 if p_expected is null or l.updated_at is distinct from p_expected then raise exception 'O lote mudou. Atualize a página antes de excluir.';end if;
 if l.status not in ('pending_payment','cancelled') or l.paid_at is not null then raise exception 'Lotes pagos não podem ser excluídos. Confira o ajuste ou reembolso antes de continuar.';end if;
 if l.charge_id is not null then raise exception 'O lote está vinculado a uma cobrança. Resolva o Pix antes de excluir.';end if;
 if l.auction_voucher_id is not null or coalesce(l.voucher_amount,0)>0 then raise exception 'O lote possui voucher. Resolva o desconto antes de excluir.';end if;
 if l.shipped_at is not null or l.moved_at is not null or exists(select 1 from public.shipment_lots where lot_id=l.id) then raise exception 'O lote já foi separado ou vinculado a um envio e não pode ser excluído.';end if;
 perform 1 from public.lot_items where lot_id=l.id for update;
 select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) into previous_items from public.lot_items i where lot_id=l.id;
 insert into public.lot_deletions(lot_id,code,snapshot,items,deleted_by) values(l.id,l.code,to_jsonb(l),previous_items,auth.uid());
 -- The existing stock reconciler locks stock rows and records returns in its ledger.
 perform public.reconcile_lot_items(l.id,'[]'::jsonb,false);
 delete from public.lots where id=l.id;
 return l.code;
end;$$;
revoke all on function public.delete_unpaid_lot(uuid,timestamptz) from public,anon;
grant execute on function public.delete_unpaid_lot(uuid,timestamptz) to authenticated;
commit;
