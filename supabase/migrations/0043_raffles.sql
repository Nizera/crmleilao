-- Rifas: campanhas novas. Não abre vendas nem modifica clientes/saldos existentes.
begin;
create table public.raffle_settings(id boolean primary key default true check(id),purchases_enabled boolean not null default false,updated_by uuid references public.admin_profiles(id),updated_at timestamptz not null default now());
insert into public.raffle_settings(id) values(true);
alter table public.raffle_settings enable row level security;
revoke all on public.raffle_settings from public,anon,authenticated;
grant select on public.raffle_settings to authenticated;
grant all on public.raffle_settings to service_role;
create policy raffle_settings_read on public.raffle_settings for select to authenticated using(public.is_admin() or public.current_customer_id() is not null);
alter table public.logistics_pending add column source_kind text not null default 'replacement' check(source_kind in ('replacement','raffle'));
create table public.raffle_campaigns (
 id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 3 and 160),
 description text not null check(length(description) between 10 and 6000),
 total_numbers integer not null check(total_numbers between 2 and 10000),
 unit_price numeric(10,2) not null check(unit_price>0 and unit_price<=10000),
 selection_mode text not null check(selection_mode in ('both','manual','automatic')),
 draw_method text not null check(draw_method in ('external','federal')),
 draw_rules text not null check(length(draw_rules) between 10 and 2000),
 shipping_date date not null, image_url text not null default '' check(image_url='' or image_url like 'https://%'),
 hide_winning_numbers boolean not null default true,
 min_quantity integer not null default 1, max_quantity integer not null default 100,
 status text not null default 'draft' check(status in ('draft','open','paused','closed')),
 created_by uuid not null references public.admin_profiles(id), created_at timestamptz not null default now(),
 check(min_quantity>=1 and min_quantity<=max_quantity and max_quantity<=1000 and max_quantity<=total_numbers)
);
create table public.raffle_prizes (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.raffle_campaigns(id),
 title text not null check(length(btrim(title)) between 1 and 160),
 kind text not null check(kind in ('main','instant')), number integer,
 unique(campaign_id,number), check((kind='main' and number is null) or (kind='instant' and number>=0))
);
create table public.raffle_orders (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.raffle_campaigns(id),
 customer_id uuid not null references public.customers(id), request_key uuid not null,
 code text not null unique default ('RF-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
 external_reference text not null unique default ('raffle_'||gen_random_uuid()::text),
 amount numeric(12,2) not null check(amount>0), numbers integer[] not null,
 status text not null default 'creating' check(status in ('creating','pending','paid','cancelled','expired','failed','review')),
 mp_order_id text unique, qr_code text, qr_code_base64 text, expires_at timestamptz,
 created_at timestamptz not null default now(), paid_at timestamptz, checked_at timestamptz,
 unique(customer_id,request_key), check(cardinality(numbers) between 1 and 1000)
);
create index raffle_orders_campaign on public.raffle_orders(campaign_id,created_at desc,id);
create index raffle_orders_customer on public.raffle_orders(customer_id,created_at desc,id);
create index raffle_orders_reconciliation on public.raffle_orders(checked_at nulls first,created_at,id) where status in ('creating','pending');
create table public.raffle_allocations (
 campaign_id uuid not null references public.raffle_campaigns(id), number integer not null check(number>=0),
 order_id uuid not null references public.raffle_orders(id), primary key(campaign_id,number)
);
create index raffle_allocations_order on public.raffle_allocations(order_id);
create table public.raffle_awards (
 id uuid primary key default gen_random_uuid(), prize_id uuid not null unique references public.raffle_prizes(id),
 campaign_id uuid not null references public.raffle_campaigns(id), order_id uuid not null references public.raffle_orders(id),
 customer_id uuid not null references public.customers(id), number integer not null,
 logistics_id uuid not null unique references public.logistics_pending(id),
 evidence_url text, result_note text, created_at timestamptz not null default now()
);
create table public.raffle_events (
 id bigint generated always as identity primary key, campaign_id uuid not null references public.raffle_campaigns(id),
 actor uuid, action text not null, created_at timestamptz not null default now()
);
create index raffle_events_campaign on public.raffle_events(campaign_id,created_at desc,id);
-- Nenhuma escrita direta pelo navegador. Cotas premiadas não têm leitura do cliente.
alter table public.raffle_campaigns enable row level security;
alter table public.raffle_prizes enable row level security;
alter table public.raffle_orders enable row level security;
alter table public.raffle_allocations enable row level security;
alter table public.raffle_awards enable row level security;
alter table public.raffle_events enable row level security;
revoke all on public.raffle_campaigns,public.raffle_prizes,public.raffle_orders,public.raffle_allocations,public.raffle_awards,public.raffle_events from public,anon,authenticated;
grant all on public.raffle_campaigns,public.raffle_prizes,public.raffle_orders,public.raffle_allocations,public.raffle_awards,public.raffle_events to service_role;
grant select on public.raffle_campaigns,public.raffle_prizes,public.raffle_orders,public.raffle_events to authenticated;
create policy raffle_campaign_read on public.raffle_campaigns for select to authenticated using(public.is_admin() or (public.current_customer_id() is not null and status<>'draft'));
create policy raffle_prize_staff on public.raffle_prizes for select to authenticated using(public.is_admin());
create policy raffle_order_read on public.raffle_orders for select to authenticated using(public.is_admin() or customer_id=public.current_customer_id());
create policy raffle_event_staff on public.raffle_events for select to authenticated using(public.is_admin());

create function public.save_raffle_campaign(p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not public.has_staff_write() then raise exception 'Acesso negado.' using errcode='42501'; end if;
 insert into public.raffle_campaigns(title,description,total_numbers,unit_price,selection_mode,draw_method,draw_rules,shipping_date,image_url,hide_winning_numbers,min_quantity,max_quantity,created_by)
 values(p_data->>'title',p_data->>'description',(p_data->>'total_numbers')::int,(p_data->>'unit_price')::numeric,p_data->>'selection_mode',p_data->>'draw_method',p_data->>'draw_rules',(p_data->>'shipping_date')::date,coalesce(p_data->>'image_url',''),(p_data->>'hide_winning_numbers')::boolean,(p_data->>'min_quantity')::int,(p_data->>'max_quantity')::int,auth.uid()) returning id into v_id;
 insert into public.raffle_events(campaign_id,actor,action) values(v_id,auth.uid(),'Campanha criada em rascunho');
 return v_id;
end; $$;

create function public.manage_raffle(p_campaign uuid,p_action text,p_title text default null,p_quantity integer default 1) returns void language plpgsql security definer set search_path='' as $$
declare c public.raffle_campaigns%rowtype; n integer; selected integer[]; v_id uuid;
begin
 if not public.has_staff_write() then raise exception 'Acesso negado.' using errcode='42501'; end if;
 select * into c from public.raffle_campaigns where id=p_campaign for update;
 if not found then raise exception 'Campanha não encontrada.'; end if;
 if p_action in ('main','instant') then
  if c.status not in ('draft','paused') then raise exception 'Pause a campanha antes de adicionar prêmios.'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 160 or p_quantity is null or p_quantity not between 1 and 100 then raise exception 'Revise o prêmio e a quantidade.'; end if;
  if (select count(*) from public.raffle_prizes where campaign_id=c.id)+p_quantity>200 then raise exception 'Limite de 200 prêmios por campanha.'; end if;
  if p_action='instant' then
   select array_agg(x.number) into selected from (select g as number from generate_series(0,c.total_numbers-1) g
    where not exists(select 1 from public.raffle_allocations a where a.campaign_id=c.id and a.number=g)
    and not exists(select 1 from public.raffle_prizes p where p.campaign_id=c.id and p.number=g)
    order by gen_random_uuid() limit p_quantity) x;
   if coalesce(cardinality(selected),0)<>p_quantity then raise exception 'Não há cotas livres suficientes.'; end if;
   foreach n in array selected loop insert into public.raffle_prizes(campaign_id,title,kind,number) values(c.id,btrim(p_title),'instant',n); end loop;
  else
   for n in 1..p_quantity loop insert into public.raffle_prizes(campaign_id,title,kind) values(c.id,btrim(p_title),'main'); end loop;
  end if;
 elsif p_action='open' then
  if c.status not in ('draft','paused') then raise exception 'Campanha indisponível.'; end if;
  if not exists(select 1 from public.raffle_prizes where campaign_id=c.id and kind='main') then raise exception 'Cadastre o prêmio principal antes de publicar.'; end if;
  update public.raffle_campaigns set status='open' where id=c.id;
 elsif p_action='pause' and c.status='open' then update public.raffle_campaigns set status='paused' where id=c.id;
 elsif p_action='close' then
  if exists(select 1 from public.raffle_orders where campaign_id=c.id and status in ('creating','pending','review')) then raise exception 'Resolva os pagamentos abertos antes de encerrar.'; end if;
  if exists(select 1 from public.raffle_prizes p where p.campaign_id=c.id and p.kind='main' and not exists(select 1 from public.raffle_awards a where a.prize_id=p.id)) then raise exception 'Registre os vencedores antes de encerrar.'; end if;
  update public.raffle_campaigns set status='closed' where id=c.id;
 else raise exception 'Ação inválida.'; end if;
 insert into public.raffle_events(campaign_id,actor,action) values(c.id,auth.uid(),p_action);
end; $$;

create function public.reserve_raffle(p_campaign uuid,p_key uuid,p_numbers integer[] default null,p_quantity integer default null) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.raffle_campaigns%rowtype; customer uuid; existing public.raffle_orders%rowtype; ns integer[]; qty integer; oid uuid;
begin
 customer:=public.current_customer_id();
 if customer is null then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_key is null then raise exception 'Pedido inválido.'; end if;
 select * into c from public.raffle_campaigns where id=p_campaign for update;
 if not found then raise exception 'Campanha não encontrada.'; end if;
 select * into existing from public.raffle_orders where customer_id=customer and request_key=p_key;
 if found then
  if existing.campaign_id<>p_campaign then raise exception 'Chave de pedido já utilizada.'; end if;
  return existing.id;
 end if;
 if not coalesce((select purchases_enabled from public.raffle_settings where id=true),false) then raise exception 'As compras de cotas ainda não foram liberadas.'; end if;
 if c.status<>'open' then raise exception 'Esta campanha não está recebendo reservas.'; end if;
 if not exists(select 1 from public.customers where id=customer and nullif(btrim(email),'') is not null) then raise exception 'Preencha seu e-mail no cadastro antes de comprar.'; end if;
 if exists(select 1 from public.raffle_orders where campaign_id=c.id and customer_id=customer and status in ('creating','pending','review')) then raise exception 'Você já tem uma reserva aberta nesta campanha. Retome em Minhas cotas.'; end if;
 if p_numbers is not null then
  if c.selection_mode='automatic' then raise exception 'Esta campanha usa seleção automática.'; end if;
  qty:=cardinality(p_numbers);
  if qty is null or array_ndims(p_numbers)<>1 or qty<> (select count(distinct x) from unnest(p_numbers) x) then raise exception 'Cotas repetidas ou inválidas.'; end if;
  if exists(select 1 from unnest(p_numbers) x where x is null or x<0 or x>=c.total_numbers) then raise exception 'Cota fora do intervalo.'; end if;
  ns:=p_numbers;
 else
  if c.selection_mode='manual' then raise exception 'Escolha os números desta campanha.'; end if;
  qty:=p_quantity;
 end if;
 if qty is null or qty<c.min_quantity or qty>c.max_quantity then raise exception 'Quantidade fora dos limites da campanha.'; end if;
 if ns is null then
  select array_agg(x.number order by x.number) into ns from (select g as number from generate_series(0,c.total_numbers-1) g
   where not exists(select 1 from public.raffle_allocations a where a.campaign_id=c.id and a.number=g)
   order by gen_random_uuid() limit qty) x;
 end if;
 if coalesce(cardinality(ns),0)<>qty or exists(select 1 from public.raffle_allocations where campaign_id=c.id and number=any(ns)) then raise exception 'Algumas cotas acabaram de ser reservadas. Atualize e escolha novamente.'; end if;
 insert into public.raffle_orders(campaign_id,customer_id,request_key,amount,numbers) values(c.id,customer,p_key,c.unit_price*qty,ns) returning id into oid;
 insert into public.raffle_allocations(campaign_id,number,order_id) select c.id,x,oid from unnest(ns) x;
 return oid;
end; $$;

-- Somente esta função privada materializa um prêmio na fila logística existente.
create function public.materialize_raffle_award(p_prize uuid,p_order uuid,p_number integer,p_note text default null,p_evidence text default null) returns void language plpgsql security definer set search_path='' as $$
declare p public.raffle_prizes%rowtype; o public.raffle_orders%rowtype; c public.raffle_campaigns%rowtype; lid uuid;
begin
 select * into p from public.raffle_prizes where id=p_prize;
 select * into o from public.raffle_orders where id=p_order;
 select * into c from public.raffle_campaigns where id=p.campaign_id;
 if o.status<>'paid' or o.campaign_id<>p.campaign_id or not p_number=any(o.numbers) then raise exception 'Cota sem pagamento confirmado.'; end if;
 if exists(select 1 from public.raffle_awards where prize_id=p.id) then return; end if;
 insert into public.logistics_pending(customer_id,title,quantity,reason,shipping_date,created_by,source_kind)
 values(o.customer_id,left(p.title,160),1,'Rifa: '||c.title||' · Cota '||lpad(p_number::text,greatest(3,length((c.total_numbers-1)::text)),'0'),c.shipping_date,c.created_by,'raffle') returning id into lid;
 insert into public.raffle_awards(prize_id,campaign_id,order_id,customer_id,number,logistics_id,result_note,evidence_url)
 values(p.id,c.id,o.id,o.customer_id,p_number,lid,p_note,p_evidence);
end; $$;

create function public.settle_raffle_payment(p_reference text,p_mp_id text,p_amount numeric,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare o public.raffle_orders%rowtype; cid uuid; prize record;
begin
 select campaign_id into cid from public.raffle_orders where external_reference=p_reference;
 if cid is null then raise exception 'Pedido não encontrado.'; end if;
 perform 1 from public.raffle_campaigns where id=cid for update;
 select * into o from public.raffle_orders where external_reference=p_reference for update;
 if p_mp_id is null or p_amount is distinct from o.amount or (o.mp_order_id is not null and o.mp_order_id<>p_mp_id) then raise exception 'Pagamento divergente.'; end if;
 if p_status not in ('paid','cancelled','expired','failed','review') then raise exception 'Status inválido.'; end if;
 if o.status='paid' and p_status<>'review' then return; end if;
 if o.status='review' then return; end if;
 if o.status in ('cancelled','expired','failed') then
  if p_status='paid' then update public.raffle_orders set status='review' where id=o.id; end if;
  return;
 end if;
 update public.raffle_orders set mp_order_id=p_mp_id,status=p_status,paid_at=case when p_status='paid' then now() else paid_at end where id=o.id;
 if p_status='paid' then
  for prize in select id,number from public.raffle_prizes where campaign_id=cid and kind='instant' and number=any(o.numbers) loop
   perform public.materialize_raffle_award(prize.id,o.id,prize.number);
  end loop;
 elsif p_status in ('cancelled','expired','failed') then delete from public.raffle_allocations where order_id=o.id;
 elsif p_status='review' then
  -- Estorno: retém cotas e bloqueia prêmios na logística; nunca redistribui prêmio automaticamente.
  update public.logistics_pending set cancelled_at=now() where id in(select logistics_id from public.raffle_awards where order_id=o.id) and shipment_id is null;
 end if;
 insert into public.raffle_events(campaign_id,action) values(cid,'Pagamento '||o.code||': '||p_status);
end; $$;

create function public.record_raffle_winner(p_prize uuid,p_number integer,p_note text,p_evidence text) returns void language plpgsql security definer set search_path='' as $$
declare p public.raffle_prizes%rowtype; oid uuid; cid uuid;
begin
 if not public.has_staff_write() then raise exception 'Acesso negado.' using errcode='42501'; end if;
 select campaign_id into cid from public.raffle_prizes where id=p_prize;
 perform 1 from public.raffle_campaigns where id=cid and status='paused' for update;
 if not found then raise exception 'Pause a campanha antes de registrar o resultado.'; end if;
 if p_note is null or length(btrim(p_note)) not between 10 and 2000 or p_evidence is null or p_evidence not like 'https://%' or length(p_evidence)>2000 then raise exception 'Informe as regras aplicadas e o link HTTPS do resultado.'; end if;
 if exists(select 1 from public.raffle_orders where campaign_id=cid and status in ('creating','pending','review')) then raise exception 'Resolva as reservas abertas antes da apuração.'; end if;
 select * into p from public.raffle_prizes where id=p_prize and kind='main';
 if not found or exists(select 1 from public.raffle_awards where prize_id=p.id) then raise exception 'Prêmio indisponível ou resultado já registrado.'; end if;
 select a.order_id into oid from public.raffle_allocations a join public.raffle_orders o on o.id=a.order_id where a.campaign_id=cid and a.number=p_number and o.status='paid';
 if oid is null then raise exception 'Esta cota não possui pagamento confirmado.'; end if;
 perform public.materialize_raffle_award(p.id,oid,p_number,p_note,p_evidence);
 insert into public.raffle_events(campaign_id,actor,action) values(cid,auth.uid(),'Resultado registrado: cota '||p_number);
end; $$;

-- Respostas explícitas: nenhuma relação revela números premiados ocultos.
create function public.get_raffle_detail(p_campaign uuid,p_from integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.raffle_campaigns%rowtype;
begin
 if public.current_customer_id() is null and not public.is_admin() then raise exception 'Acesso negado.' using errcode='42501'; end if;
 select * into c from public.raffle_campaigns where id=p_campaign and (status<>'draft' or public.is_admin());
 if not found then raise exception 'Campanha não encontrada.'; end if;
 return jsonb_build_object('campaign',to_jsonb(c)-'created_by',
 'paid',(select count(*) from public.raffle_allocations a join public.raffle_orders o on o.id=a.order_id where a.campaign_id=c.id and o.status='paid'),
 'reserved',(select count(*) from public.raffle_allocations a join public.raffle_orders o on o.id=a.order_id where a.campaign_id=c.id and o.status<>'paid'),
 'prizes',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'kind',p.kind,'number',case when not c.hide_winning_numbers then p.number else null end,'found',exists(select 1 from public.raffle_awards a where a.prize_id=p.id)) order by p.kind,p.id),'[]') from public.raffle_prizes p where campaign_id=c.id),
 'results',(select coalesce(jsonb_agg(jsonb_build_object('title',p.title,'number',a.number,'note',a.result_note,'evidence',a.evidence_url,'status',o.status)),'[]') from public.raffle_awards a join public.raffle_prizes p on p.id=a.prize_id join public.raffle_orders o on o.id=a.order_id where a.campaign_id=c.id and p.kind='main'),
 'numbers',(select coalesce(jsonb_agg(jsonb_build_object('number',g,'state',case when o.status='paid' then 'paid' when a.order_id is not null then 'reserved' else 'available' end) order by g),'[]') from generate_series(greatest(0,least(p_from,c.total_numbers-1)),least(c.total_numbers-1,greatest(0,p_from)+99)) g left join public.raffle_allocations a on a.campaign_id=c.id and a.number=g left join public.raffle_orders o on o.id=a.order_id));
end; $$;
create function public.get_raffle_awards(p_page integer default 1,p_orders uuid[] default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_customer_id() is null and not public.is_admin() then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_orders is not null and cardinality(p_orders)>10 then raise exception 'Limite de pedidos por consulta.'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select a.id,a.campaign_id,a.order_id,a.customer_id,a.number,a.logistics_id,p.title,p.kind,c.title campaign_title,c.total_numbers,cu.name customer_name,l.moved_at,l.shipment_id,l.cancelled_at,s.tracking_code,s.status shipment_status
 from public.raffle_awards a join public.customers cu on cu.id=a.customer_id join public.raffle_prizes p on p.id=a.prize_id join public.raffle_campaigns c on c.id=a.campaign_id join public.logistics_pending l on l.id=a.logistics_id left join public.shipments s on s.id=l.shipment_id
 where (public.is_admin() or a.customer_id=public.current_customer_id()) and (p_orders is null or a.order_id=any(p_orders))
 order by a.created_at desc,a.id limit (case when p_orders is null then 20 else 2000 end) offset (case when p_orders is null then (greatest(1,least(coalesce(p_page,1),10000))-1)*20 else 0 end)) x);
end; $$;

revoke all on function public.materialize_raffle_award(uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
revoke all on function public.settle_raffle_payment(text,text,numeric,text) from public,anon,authenticated;
grant execute on function public.settle_raffle_payment(text,text,numeric,text) to service_role;
revoke all on function public.save_raffle_campaign(jsonb),public.manage_raffle(uuid,text,text,integer),public.reserve_raffle(uuid,uuid,integer[],integer),public.record_raffle_winner(uuid,integer,text,text),public.get_raffle_detail(uuid,integer),public.get_raffle_awards(integer,uuid[]) from public,anon;
grant execute on function public.save_raffle_campaign(jsonb),public.manage_raffle(uuid,text,text,integer),public.reserve_raffle(uuid,uuid,integer[],integer),public.record_raffle_winner(uuid,integer,text,text),public.get_raffle_detail(uuid,integer),public.get_raffle_awards(integer,uuid[]) to authenticated;

create function public.set_raffle_purchases(p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.admin_profiles where id=auth.uid() and role='owner') then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_enabled is null then raise exception 'Configuração inválida.'; end if;
 update public.raffle_settings set purchases_enabled=p_enabled,updated_by=auth.uid(),updated_at=now() where id=true;
end; $$;
create function public.get_raffle_admin_stats(p_campaign uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Acesso negado.' using errcode='42501'; end if;
 return (select jsonb_build_object('received',coalesce(sum(amount) filter(where status='paid'),0),'paid',coalesce(sum(cardinality(numbers)) filter(where status='paid'),0),'reserved',(select count(*) from public.raffle_allocations a join public.raffle_orders o on o.id=a.order_id where a.campaign_id=p_campaign and o.status<>'paid')) from public.raffle_orders where campaign_id=p_campaign);
end; $$;
create function public.get_raffle_admin_awarded(p_campaign uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Acesso negado.' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(prize_id),'[]') from public.raffle_awards where campaign_id=p_campaign);
end; $$;
create function public.list_raffle_admin_orders(p_campaign uuid default null,p_status text default null,p_search text default '',p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; total bigint; query text:=left(coalesce(p_search,''),100);
begin
 if not public.is_admin() then raise exception 'Acesso negado.' using errcode='42501'; end if;
 select count(*) into total from public.raffle_orders o join public.customers c on c.id=o.customer_id
 where (p_campaign is null or o.campaign_id=p_campaign) and (p_status is null or o.status=p_status)
 and (query='' or strpos(lower(c.name),lower(query))>0 or strpos(c.phone_e164,query)>0 or strpos(lower(o.code),lower(query))>0 or exists(select 1 from unnest(o.numbers) n where n::text=ltrim(query,'0') or (n=0 and query~'^0+$')));
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
 select o.id,o.campaign_id,o.code,o.status,o.numbers,o.amount,o.created_at,c.name customer_name,c.phone_e164,r.title campaign_title,r.total_numbers,
 exists(select 1 from public.raffle_awards a where a.order_id=o.id) has_award
 from public.raffle_orders o join public.customers c on c.id=o.customer_id join public.raffle_campaigns r on r.id=o.campaign_id
 where (p_campaign is null or o.campaign_id=p_campaign) and (p_status is null or o.status=p_status)
 and (query='' or strpos(lower(c.name),lower(query))>0 or strpos(c.phone_e164,query)>0 or strpos(lower(o.code),lower(query))>0 or exists(select 1 from unnest(o.numbers) n where n::text=ltrim(query,'0') or (n=0 and query~'^0+$')))
 order by o.created_at desc,o.id limit 20 offset (greatest(1,least(coalesce(p_page,1),10000))-1)*20) x;
 return jsonb_build_object('total',total,'items',result);
end; $$;
revoke all on function public.set_raffle_purchases(boolean),public.get_raffle_admin_stats(uuid),public.get_raffle_admin_awarded(uuid),public.list_raffle_admin_orders(uuid,text,text,integer) from public,anon;
grant execute on function public.set_raffle_purchases(boolean),public.get_raffle_admin_stats(uuid),public.get_raffle_admin_awarded(uuid),public.list_raffle_admin_orders(uuid,text,text,integer) to authenticated;
create function public.claim_raffle_reconciliation() returns setof public.raffle_orders language sql security definer set search_path='' as $$
 with candidates as (
 select id from public.raffle_orders where status in ('creating','pending') and (checked_at is null or checked_at<now()-interval '5 minutes')
 order by checked_at nulls first,created_at,id limit 2 for update skip locked
 ) update public.raffle_orders o set checked_at=now() from candidates c where c.id=o.id returning o.*;
$$;
revoke all on function public.claim_raffle_reconciliation() from public,anon,authenticated;
grant execute on function public.claim_raffle_reconciliation() to service_role;
commit;
