import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const migration=await readFile(new URL('../supabase/migrations/0034_loyalty_rank_history.sql',import.meta.url),'utf8');
const customer='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const lot='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const charge='dddddddd-dddd-4ddd-8ddd-dddddddddddd';

async function fixture(){
 const db=new PGlite();
 await db.exec(`
 create role anon;create role authenticated;create role service_role;
 create function public.current_customer_id() returns uuid language sql stable as $$
   select nullif(current_setting('test.customer',true),'')::uuid $$;
 create function public.is_admin() returns boolean language sql stable as $$
   select coalesce(current_setting('test.admin',true),'false')='true' $$;
 create table public.customers(id uuid primary key,name text,loyalty_rank_visible boolean default true);
 create table public.loyalty_settings(id boolean primary key,active boolean,ranking_enabled boolean);
 create table public.lots(id uuid primary key,customer_id uuid references customers(id),status text,
   arremate_value numeric,charge_id uuid,loyalty_points_awarded numeric default 0);
 create table public.loyalty_ledger(id uuid primary key default gen_random_uuid(),customer_id uuid references customers(id),
   points numeric not null,kind text,lot_id uuid references lots(id),lot_value numeric,earn_rate numeric,note text);
 create unique index earned_once on loyalty_ledger(lot_id,kind) where lot_id is not null;
 insert into loyalty_settings values(true,true,true);
 insert into customers values('${customer}','Cliente Antigo',true),('${other}','Cliente Novo',true);
 `);
 await db.exec(migration);
 await db.exec(`create trigger award before insert or update on lots
   for each row execute function public.award_lot_loyalty_points();`);
 return db;
}

test('histórico eleva ranking e líderes sem criar lotes ou Caracoins; próximas compras usam o elo',async()=>{
 const db=await fixture();
 try{
  await db.query('insert into loyalty_rank_history(customer_id,source_key,paid_amount,rank_points,note) values($1,$2,6900,6007.5,$3)',[customer,'csv-outubro','Apenas ranking']);
  await db.exec(`set test.customer='${customer}';`);
  assert.equal(Number((await db.query('select get_customer_loyalty_earned_points() as rank')).rows[0].rank),6007.5);
  assert.equal((await db.query('select count(*)::int as n from loyalty_ledger')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int as n from lots')).rows[0].n,0);
  const leaders=(await db.query('select * from get_loyalty_tier_leaders()')).rows;
  assert.equal(leaders.find(x=>x.tier_key==='prata').points,'6007.50');
  await db.query("insert into lots(id,customer_id,status,arremate_value,charge_id) values($1,$2,'pending_payment',100,$3)",[lot,customer,charge]);
  await db.exec(`update lots set status='paid' where id='${lot}'`);
  assert.equal(Number((await db.query('select sum(points) as coins from loyalty_ledger')).rows[0].coins),150);
  assert.equal(Number((await db.query('select get_customer_loyalty_earned_points() as rank')).rows[0].rank),6157.5);
  // Resgate afeta só o saldo; cancelamento estorna somente o lote do app.
  await db.query("insert into loyalty_ledger(customer_id,points,kind,note) values($1,-50,'spent','Resgate')",[customer]);
  assert.equal(Number((await db.query('select get_customer_loyalty_earned_points() as rank')).rows[0].rank),6157.5);
  await db.exec(`update lots set status='cancelled' where id='${lot}'`);
  assert.equal(Number((await db.query('select get_customer_loyalty_earned_points() as rank')).rows[0].rank),6007.5);
  // Mesma migração reaplicada mantém o histórico intacto.
  await db.exec(migration);
  assert.equal((await db.query('select count(*)::int as n from loyalty_rank_history')).rows[0].n,1);
 }finally{await db.close();}
});

test('histórico é privado, consulta de ranking respeita cliente e opt-out público',async()=>{
 const db=await fixture();
 try{
  await db.query('insert into loyalty_rank_history(customer_id,source_key,paid_amount,rank_points,note) values($1,$2,6900,6007.5,$3)',[customer,'csv-outubro','Apenas ranking']);
  await assert.rejects(()=>db.query('select get_customer_loyalty_earned_points($1)',[customer]),/Acesso negado/);
  await db.exec(`set test.customer='${other}'`);
  await assert.rejects(()=>db.query('select get_customer_loyalty_earned_points($1)',[customer]),/Acesso negado/);
  await db.exec('set role authenticated');
  await assert.rejects(()=>db.query('select * from loyalty_rank_history'),/permission denied/);
  await db.exec('reset role');
  await db.exec(`update customers set loyalty_rank_visible=false where id='${customer}'`);
  assert.equal((await db.query("select points from get_loyalty_tier_leaders() where tier_key='prata'")).rows[0].points,null);
 }finally{await db.close();}
});
