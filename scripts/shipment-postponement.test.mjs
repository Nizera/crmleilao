import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('adiamento por cliente/data preserva cobranças, prazos, caixa e etiquetas', async () => {
 const db = new PGlite();
 const uuid = () => crypto.randomUUID();
 const customer=uuid(), other=uuid(), label=uuid(), cancelledLabel=uuid();
 const ids=Array.from({length:8},uuid), issues=Array.from({length:4},uuid);
 try {
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
 create function has_staff_write() returns boolean language sql as $$select current_setting('test.staff',true)='true'$$;
 create table customers(id uuid primary key);
 create table shipments(id uuid primary key, status text);
 create table lots(id uuid primary key,customer_id uuid,status text,shipping_date date,arremate_value numeric default 80,charge_id uuid,payment_due_at timestamptz default '2030-01-01T20:00:00Z',moved_at timestamptz default '2029-12-30T20:00:00Z');
 create table shipment_lots(lot_id uuid,shipment_id uuid);
 create table logistics_pending(id uuid primary key,customer_id uuid,shipping_date date,source_kind text,cancelled_at timestamptz,shipment_id uuid,moved_at timestamptz default '2029-12-30T20:00:00Z');
 create table charges(id uuid primary key,status text,freight_amount numeric);
 `);
 const migration = await readFile('supabase/migrations/0084_postpone_customer_shipping.sql','utf8');
 await db.exec(migration); await db.exec(migration);
 await db.query('insert into customers values($1),($2)',[customer,other]);
 await db.query("insert into shipments values($1,'released'),($2,'cancelled')",[label,cancelledLabel]);
 const charge=uuid();await db.query("insert into charges values($1,'approved',20)",[charge]);
 for(let i=0;i<ids.length;i++) await db.query('insert into lots(id,customer_id,status,shipping_date,charge_id) values($1,$2,$3,$4,$5)',[ids[i],i===4?other:customer,i===1?'pending_payment':i===5?'cancelled':i===6?'shipped':'paid',i===3?'2099-11-24':'2099-11-17',charge]);
 await db.query('insert into shipment_lots values($1,$2),($3,$4)',[ids[2],label,ids[7],cancelledLabel]);
 for(let i=0;i<issues.length;i++)await db.query('insert into logistics_pending(id,customer_id,shipping_date,source_kind,shipment_id,cancelled_at) values($1,$2,$3,$4,$5,$6)',[issues[i],customer,i===3?'2099-11-24':'2099-11-17',i===0?'raffle':'replacement',i===1?label:null,i===2?'2029-12-30T20:00:00Z':null]);
 const before=(await db.query('select id,customer_id,status,shipping_date::text,arremate_value,charge_id,payment_due_at,moved_at from lots order by id')).rows;
 await db.exec("set role authenticated; select set_config('test.staff','false',false)");
 await assert.rejects(db.query("select postpone_customer_shipping($1,'2099-11-17','2099-11-24',true)",[customer]),/Acesso negado/);
 await db.exec("select set_config('test.staff','true',false)");
 await assert.rejects(db.query("select postpone_customer_shipping($1,'2099-11-17','2099-11-17',true)",[customer]),/data/);
 await assert.rejects(db.query("select postpone_customer_shipping($1,'2099-11-17','2000-11-24',true)",[customer]),/data/);
 await assert.rejects(db.query("select postpone_customer_shipping($1,'2099-11-17','2099-11-24',null)",[customer]),/data/);
 const result=(await db.query("select postpone_customer_shipping($1,'2099-11-17','2099-11-24',false) as result",[customer])).rows[0].result;
 assert.deepEqual(result,{lots:3,logistics:0});
 await assert.rejects(db.query("select postpone_customer_shipping($1,'2099-11-17','2099-11-24',false)",[customer]),/Nenhum item/);
 const logistics=(await db.query("select postpone_customer_shipping($1,'2099-11-17','2099-11-24',true) as result",[customer])).rows[0].result;
 assert.deepEqual(logistics,{lots:0,logistics:1});
 await assert.rejects(db.query('select * from shipping_postponements'),/permission denied/);
 await db.exec('reset role');
 const after=(await db.query('select id,customer_id,status,shipping_date::text,arremate_value,charge_id,payment_due_at,moved_at from lots order by id')).rows;
 for(let i=0;i<before.length;i++){
  const {shipping_date:oldDate,...oldRest}=before[i]; const {shipping_date:newDate,...newRest}=after[i];
  assert.deepEqual(newRest,oldRest);
  assert.equal(newDate,[ids[0],ids[1],ids[7]].includes(before[i].id)?'2099-11-24':oldDate);
 }
 assert.equal((await db.query('select shipping_date::text from logistics_pending where id=$1',[issues[0]])).rows[0].shipping_date,'2099-11-24');
 assert.equal((await db.query('select shipping_date::text from logistics_pending where id=$1',[issues[1]])).rows[0].shipping_date,'2099-11-17');
 assert.equal((await db.query('select count(*)::int as n from shipping_postponements')).rows[0].n,2);
 assert.deepEqual((await db.query('select status,freight_amount from charges')).rows,[{status:'approved',freight_amount:'20'}]);
 assert.equal((await db.query('select count(*)::int as n from shipment_lots')).rows[0].n,2);
 } finally { await db.close(); }
});
