import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const staff = '11111111-1111-4111-8111-111111111111';
const customer = '22222222-2222-4222-8222-222222222222';
const shipment = '33333333-3333-4333-8333-333333333333';
const fixture = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user',true),'')::uuid $$;
create function public.is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin',true),'false')='true' $$;
create function public.has_staff_write() returns boolean language sql stable as $$ select public.is_admin() and coalesce(current_setting('test.viewer',true),'false')<>'true' $$;
create table public.admin_profiles(id uuid primary key);
create table public.customers(id uuid primary key,name text,phone_e164 text);
create table public.shipments(id uuid primary key,customer_id uuid,batch_date date,status text,code text,tracking_code text);
create table public.charges(id integer primary key,amount numeric);
create table public.lots(id integer primary key,amount numeric);
create table public.loyalty_ledger(id integer primary key,points numeric);
insert into public.charges values(1,120); insert into public.lots values(1,100); insert into public.loyalty_ledger values(1,50);
create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create function public.bind_store_orders_to_shipment(uuid) returns integer language plpgsql security definer as $$ begin
 if coalesce(current_setting('test.fail_base',true),'false')='true' then raise exception 'frete não pago'; end if;
 return 0; end $$;
grant usage on schema public,auth to authenticated,anon,service_role;
grant select on public.customers,public.shipments to authenticated;
insert into public.admin_profiles values('${staff}');
insert into public.customers values('${customer}','Cliente teste','+5511000000000');
insert into public.shipments values('${shipment}','${customer}','2026-11-03','pending','ENV-TESTE',null);
select set_config('test.user','${staff}',false),set_config('test.admin','true',false);
`;

test('Reposição: permissões, separação, vínculo, rollback financeiro e cancelamento da etiqueta', async () => {
  const db = new PGlite();
  const scalar = async (sql, args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
  try {
    await db.exec(fixture);
    await db.exec(await readFile(new URL('../supabase/migrations/0035_logistics_pending.sql', import.meta.url),'utf8'));
    const create = (title='Figurinha faltante', day='2026-11-03') => scalar('select public.create_logistics_pending($1,$2,1,$3,$4)',[customer,title,'Faltou no pacote anterior',day]);
    const issue = await create();
    assert.equal(await scalar('select count(*)::int from logistics_pending where moved_at is null'),1);
    assert.equal(await scalar('select state from logistics_pending_list where id=$1',[issue]),'open');
    await assert.rejects(db.query('select bind_store_orders_to_shipment($1)',[shipment]),/Separe as pendências/);
    await db.query("select handle_logistics_pending($1,'box')",[issue]);
    const moved = await scalar('select moved_at from logistics_pending where id=$1',[issue]);
    await db.query("select handle_logistics_pending($1,'box')",[issue]);
    assert.deepEqual(await scalar('select moved_at from logistics_pending where id=$1',[issue]),moved);
    // Falha no guard de frete/loja não consome a reposição.
    await db.exec("select set_config('test.fail_base','true',false)");
    await assert.rejects(db.query('select bind_store_orders_to_shipment($1)',[shipment]),/frete não pago/);
    assert.equal(await scalar('select shipment_id from logistics_pending where id=$1',[issue]),null);
    await db.exec("select set_config('test.fail_base','false',false)");
    const future = await create('Reposição futura','2026-11-10');
    await db.query('select bind_store_orders_to_shipment($1)',[shipment]);
    assert.equal(await scalar('select shipment_id from logistics_pending where id=$1',[issue]),shipment);
    assert.equal(await scalar('select shipment_id from logistics_pending where id=$1',[future]),null);
    await assert.rejects(db.query("select handle_logistics_pending($1,'cancel')",[issue]),/vinculada/);
    await db.query("update shipments set status='posted' where id=$1",[shipment]);
    assert.equal(await scalar('select state from logistics_pending_list where id=$1',[issue]),'shipped');
    await db.query("update shipments set status='delivered' where id=$1",[shipment]);
    assert.equal(await scalar('select state from logistics_pending_list where id=$1',[issue]),'delivered');
    // Simula cancelamento recebido na sincronização/webhook.
    await db.query("update shipments set status='cancelled' where id=$1",[shipment]);
    assert.equal(await scalar('select shipment_id from logistics_pending where id=$1',[issue]),null);
    assert.equal(await scalar('select state from logistics_pending_list where id=$1',[issue]),'boxed');
    await db.query("select handle_logistics_pending($1,'reschedule','2026-11-10')",[issue]);
    await db.query("select handle_logistics_pending($1,'reopen')",[issue]);
    assert.equal(await scalar('select state from logistics_pending_list where id=$1',[issue]),'open');
    await db.query("select handle_logistics_pending($1,'cancel')",[issue]);
    assert.equal(await scalar('select state from logistics_pending_list where id=$1',[issue]),'cancelled');
    // Nenhum lançamento financeiro ou de lote foi criado/alterado.
    assert.deepEqual((await db.query('select (select sum(amount) from charges) charges,(select sum(amount) from lots) lots,(select sum(points) from loyalty_ledger) points')).rows[0],{charges:'120',lots:'100',points:'50'});
    // Usuário comum não lê pelo SQL direto nem pela view e não grava por RPC.
    await db.exec("select set_config('test.admin','false',false); set role authenticated;");
    assert.equal(await scalar('select count(*)::int from logistics_pending'),0);
    assert.equal(await scalar('select count(*)::int from logistics_pending_list'),0);
    await assert.rejects(create(),/Acesso negado/);
    await assert.rejects(db.query("select handle_logistics_pending($1,'box')",[future]),/Acesso negado/);
    await assert.rejects(db.query('select bind_store_orders_to_shipment($1)',[shipment]),/permission denied/);
    await assert.rejects(db.query("update logistics_pending set title='alterado'"),/permission denied/);
    await db.exec("reset role; select set_config('test.admin','true',false),set_config('test.viewer','true',false); set role authenticated;");
    assert.equal(await scalar('select count(*)::int from logistics_pending'),2);
    await assert.rejects(create(),/Acesso negado/);
    await assert.rejects(db.query("select handle_logistics_pending($1,'box')",[future]),/Acesso negado/);
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select * from logistics_pending_list'),/permission denied/);
    await assert.rejects(create(),/permission denied/);
  } finally { await db.close(); }
});
