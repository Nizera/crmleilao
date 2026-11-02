begin;
alter table public.raffle_campaigns add column archived_at timestamptz,
 add column archived_status text check(archived_status in('draft','paused','closed'));
create index raffle_campaigns_archive on public.raffle_campaigns(archived_at,created_at desc);
create table public.raffle_campaign_lifecycle_events(
 id bigint generated always as identity primary key,campaign_id uuid not null,
 title text not null,actor uuid not null,action text not null check(action in('archive','restore','delete')),
 created_at timestamptz not null default now());
alter table public.raffle_campaign_lifecycle_events enable row level security;
revoke all on public.raffle_campaign_lifecycle_events from public,anon,authenticated;
grant select on public.raffle_campaign_lifecycle_events to authenticated;
grant all on public.raffle_campaign_lifecycle_events to service_role;
create policy raffle_lifecycle_staff on public.raffle_campaign_lifecycle_events for select to authenticated using(public.is_admin());

create function public.guard_archived_raffle() returns trigger language plpgsql set search_path='' as $$
begin
 if new.archived_at is not null and new.status='open' then raise exception 'Restaure a campanha antes de abrir vendas.'; end if;
 return new;
end; $$;
create trigger raffle_archived_sales before insert or update of status,archived_at on public.raffle_campaigns for each row execute function public.guard_archived_raffle();
revoke all on function public.guard_archived_raffle() from public,anon,authenticated,service_role;

create function public.raffle_campaign_lifecycle(p_campaign uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare c public.raffle_campaigns%rowtype;
begin
 if not public.has_staff_write() then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_action not in('archive','restore','delete') or p_action is null then raise exception 'Ação inválida.'; end if;
 select * into c from public.raffle_campaigns where id=p_campaign for update;
 if not found then raise exception 'Campanha não encontrada.'; end if;
 if p_action='archive' then
  if c.archived_at is not null then return; end if;
  update public.raffle_campaigns set archived_at=now(),archived_status=case when status='open' then 'paused' else status end,status=case when status='open' then 'paused' else status end where id=c.id;
 elsif p_action='restore' then
  if c.archived_at is null then return; end if;
  update public.raffle_campaigns set archived_at=null,status=coalesce(archived_status,'paused'),archived_status=null where id=c.id;
 else
  if not exists(select 1 from public.admin_profiles where id=auth.uid() and role='owner') then raise exception 'Somente o dono pode excluir campanhas.' using errcode='42501'; end if;
  if c.status<>'draft' or exists(select 1 from public.raffle_orders where campaign_id=c.id) or exists(select 1 from public.raffle_awards where campaign_id=c.id) then raise exception 'Só é possível excluir rascunhos sem reservas ou prêmios conquistados. Arquive esta campanha para preservar o histórico.'; end if;
  delete from public.raffle_events where campaign_id=c.id;
  delete from public.raffle_prizes where campaign_id=c.id;
  delete from public.raffle_campaigns where id=c.id;
 end if;
 insert into public.raffle_campaign_lifecycle_events(campaign_id,title,actor,action) values(c.id,c.title,auth.uid(),p_action);
end; $$;
revoke all on function public.raffle_campaign_lifecycle(uuid,text) from public,anon;
grant execute on function public.raffle_campaign_lifecycle(uuid,text) to authenticated;
commit;
