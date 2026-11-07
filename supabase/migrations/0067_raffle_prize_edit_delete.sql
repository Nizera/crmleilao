begin;
-- Editar ou excluir somente prêmios instantâneos ainda livres, com vendas pausadas.
create or replace function public.edit_raffle_instant_prize(p_prize uuid,p_action text,p_title text,p_expected_title text) returns void
language plpgsql security definer set search_path='' as $$
declare p public.raffle_prizes%rowtype;c public.raffle_campaigns%rowtype;cid uuid;
begin
 if public.has_staff_write() is not true then raise exception 'Acesso negado.' using errcode='42501';end if;
 if p_action is null or p_action not in ('edit','delete') then raise exception 'Ação inválida.';end if;
 select campaign_id into cid from public.raffle_prizes where id=p_prize;
 select * into c from public.raffle_campaigns where id=cid for update;
 if not found or c.status not in ('draft','paused') or c.archived_at is not null then raise exception 'Pause as vendas antes de editar ou excluir cotas premiadas.';end if;
 select * into p from public.raffle_prizes where id=p_prize and kind='instant' for update;
 if not found then raise exception 'Cota premiada não encontrada.';end if;
 if p.title is distinct from p_expected_title then raise exception 'Este prêmio foi atualizado. Recarregue a página antes de continuar.';end if;
 if exists(select 1 from public.raffle_awards where prize_id=p.id) or exists(select 1 from public.raffle_allocations where campaign_id=c.id and number=p.number) then raise exception 'Este prêmio já está reservado ou foi encontrado e não pode ser alterado ou excluído.';end if;
 if p_action='edit' then
  if p_title is null or length(btrim(p_title)) not between 1 and 160 then raise exception 'Informe o nome do prêmio.';end if;
  update public.raffle_prizes set title=btrim(p_title) where id=p.id;
 else
  delete from public.raffle_prizes where id=p.id;
 end if;
 insert into public.raffle_events(campaign_id,actor,action) values(c.id,auth.uid(),left('Cota premiada '||p.number||': '||p_action||' — '||p.title,500));
end $$;
revoke all on function public.edit_raffle_instant_prize(uuid,text,text,text) from public,anon;
grant execute on function public.edit_raffle_instant_prize(uuid,text,text,text) to authenticated;
commit;
