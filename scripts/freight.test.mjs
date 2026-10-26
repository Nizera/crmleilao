import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('Frete obrigatório: vínculo ao primeiro lote, ciclos, reserva, bloqueio e totais',async t=>{
 const db=new PGlite();
 const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const l1='11111111-1111-4111-8111-111111111111',l2='22222222-2222-4222-8222-222222222222',l3='33333333-3333-4333-8333-333333333333';
 const charge='cccccccc-cccc-4ccc-8ccc-cccccccccccc',other='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table customers(id uuid primary key);
 create function public.current_customer_id() returns uuid language sql stable as $$select nullif(current_setting('test.customer',true),'')::uuid$$;
 create table charges(id uuid primary key,customer_id uuid references customers(id),code text,amount numeric not null check(amount>0),freight_amount numeric default 0,freight_period date,status text default 'pending',expires_at timestamptz,paid_at timestamptz,created_at timestamptz default now());
 create unique index legacy_freight_once on charges(customer_id,freight_period) where freight_amount>0 and status in('pending','in_process','approved');
 create table lots(id uuid primary key,customer_id uuid references customers(id),charge_id uuid references charges(id),auction_date date,status text default 'pending_payment',arremate_value numeric,created_at timestamptz default now());
 insert into customers values('${a}'),('${b}');
 insert into lots values('${l1}','${a}',null,'2026-10-20','pending_payment',30,'2026-10-20 15:00Z'),('${l2}','${a}',null,'2026-10-26','pending_payment',20,'2026-10-26 15:00Z'),('${l3}','${a}',null,'2026-10-27','pending_payment',50,'2026-10-27 15:00Z');
 insert into charges(id,customer_id,code,amount,freight_amount,freight_period,status) values('${other}','${b}','ANTIGO',20,20,'2026-10-20','approved');`);
 await db.exec(await readFile(new URL('../supabase/migrations/0029_mandatory_period_freight.sql',import.meta.url),'utf8'));
 const scalar=async sql=>(await db.query(sql)).rows[0];
 await t.test('terça e segunda compartilham ciclo; próxima terça abre outro',async()=>{
  const rows=(await db.query(`select freight_period::text,first_lot_id,freight_amount::float from get_due_freight_periods('${a}')`)).rows;
  assert.deepEqual(rows,[{freight_period:'2026-10-20',first_lot_id:l1,freight_amount:20},{freight_period:'2026-10-27',first_lot_id:l3,freight_amount:20}]);
  assert.equal((await scalar(`select get_customer_pending_payment_total('${a}')::float as total`)).total,140);
  assert.equal((await db.query(`select * from charge_freight_periods where customer_id='${b}'`)).rows.length,1);
 });
 await db.exec(`insert into charges(id,customer_id,code,amount) values('${charge}','${a}','NOVO',140)`);
 await t.test('não permite ligar lote a Pix sem frete',async()=>{
  await assert.rejects(db.exec(`update lots set charge_id='${charge}' where id='${l1}'`),/frete do ciclo/i);
  await assert.rejects(db.exec(`select assert_customer_shipping_ready('${a}')`),/lotes pendentes/i);
 });
 await t.test('não permite deixar de fora o primeiro lote pendente de um ciclo',async()=>{
  await assert.rejects(db.exec(`select reserve_charge_freights('${charge}',array['${l2}']::uuid[])`),/primeiro lote/i);
  assert.equal((await scalar(`select count(*)::int as n from charge_freight_items where charge_id='${charge}'`)).n,0);
 });
 await t.test('um Pix inclui dois ciclos uma única vez e preserva total de lotes',async()=>{
  await db.exec(`select reserve_charge_freights('${charge}',array['${l1}','${l2}','${l3}']::uuid[]);update lots set charge_id='${charge}' where customer_id='${a}';`);
  assert.deepEqual(await scalar(`select amount::float,freight_amount::float from charges where id='${charge}'`),{amount:140,freight_amount:40});
  assert.equal((await scalar(`select get_customer_pending_payment_total('${a}')::float as total`)).total,140);
  assert.equal((await db.query(`select * from get_due_freight_periods('${a}')`)).rows.length,0);
  await db.exec(`select reserve_charge_freights('${charge}',array['${l1}','${l2}','${l3}']::uuid[])`);
  assert.deepEqual(await scalar(`select amount::float,freight_amount::float from charges where id='${charge}'`),{amount:140,freight_amount:40});
 });
 await t.test('aprovação sincroniza ambos os períodos sem cobrar novamente',async()=>{
  await db.exec(`update charges set status='approved' where id='${charge}';update lots set status='paid' where customer_id='${a}';`);
  assert.equal((await scalar(`select count(*)::int as n from charge_freight_periods where customer_id='${a}' and status='approved'`)).n,2);
  assert.equal((await scalar(`select get_customer_pending_payment_total('${a}')::float as total`)).total,0);
  await db.exec(`select assert_customer_shipping_ready('${a}')`);
 });
 await t.test('nova pendência bloqueia pagar etiqueta já criada',async()=>{
  await db.exec(`update lots set status='pending_payment' where id='${l2}'`);
  await assert.rejects(db.exec(`select assert_customer_shipping_ready('${a}')`),/lotes pendentes/i);
  await db.exec(`update lots set status='paid' where id='${l2}'`);
 });
 await t.test('operações internas não são executáveis por clientes',async()=>{
  await db.exec('set role authenticated');
  await assert.rejects(db.query(`select * from get_due_freight_periods('${a}')`),/permission denied/i);
  await assert.rejects(db.query('select * from charge_freight_items'),/permission denied/i);
  await db.exec('reset role');
 });
 await db.close();
});
