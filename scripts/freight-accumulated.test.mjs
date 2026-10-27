import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
const read=file=>readFile(new URL(file,import.meta.url),'utf8');

test('Home: mantém pendentes antigos e lotes do dia, sem substituir hoje pelo último leilão',async()=>{
 const code=ts.transpileModule(await read('../src/lib/client-home.ts'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
 const {selectHomeLots}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
 const lots=[{id:'pending-old',auction_date:'2026-10-13',status:'pending_payment'},{id:'paid-old',auction_date:'2026-10-20',status:'paid'},{id:'paid-today',auction_date:'2026-10-26',status:'paid'},{id:'pending-today',auction_date:'2026-10-26',status:'pending_payment'}];
 assert.deepEqual(selectHomeLots(lots,'2026-10-26').map(l=>l.id),['pending-old','paid-today','pending-today']);
 assert.deepEqual(selectHomeLots(lots.filter(l=>l.status==='paid'),'2026-10-27'),[]);
});

test('Frete: semanas acumuladas custam R$20, crédito reaproveitado até a etiqueta, cancelamento preserva crédito',async()=>{
 const db=new PGlite();const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const customer='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 try{
  await db.exec(await read('./fixtures/store-baseline.sql'));await db.exec(await read('./fixtures/store-current.sql'));
  await db.exec(`create table public.charges(id uuid primary key default gen_random_uuid(),customer_id uuid,code text default 'P-FIXTURE',freight_period date,freight_amount numeric default 0,amount numeric default 0,status text default 'pending',expires_at timestamptz,paid_at timestamptz,created_at timestamptz default now());
   alter table public.lots add column auction_date date,add column charge_id uuid references public.charges(id),add column arremate_value numeric default 30,add column created_at timestamptz default now();
   create unique index charges_freight_period_uidx on charges(customer_id,freight_period) where freight_amount>0 and status in('pending','in_process','approved');
   grant all on public.charges,public.lots,public.shipments,public.shipment_lots to service_role;`);
  for(const file of ['0024_store_cart_and_pix.sql','0025_store_catalog_admin.sql','0026_admin_order_history.sql','0027_store_dashboard.sql','0028_loyalty_history_and_client_store.sql','0031_store_reliability_and_fulfillment.sql'])await db.exec(await read('../supabase/migrations/'+file));
  const previous=await read('../supabase/migrations/0029_mandatory_period_freight.sql');
  await db.exec(previous.slice(previous.indexOf('create table public.charge_freight_items'),previous.indexOf('create function public.get_due_freight_periods')));
  // Etiqueta antiga com frete pago em um Pix separado do Pix dos lotes.
  const oldCustomer=crypto.randomUUID(),oldLot=crypto.randomUUID(),oldFreight=crypto.randomUUID(),oldShipment=crypto.randomUUID();
  await db.query('insert into customers(id,email) values($1,$2)',[oldCustomer,'old@example.invalid']);
  await db.query("insert into charges(id,customer_id,status,freight_amount,freight_period) values($1,$2,'approved',20,'2026-10-13')",[oldFreight,oldCustomer]);
  await db.query("insert into lots(id,customer_id,status,auction_date) values($1,$2,'paid','2026-10-14')",[oldLot,oldCustomer]);
  await db.query('insert into shipments(id,customer_id,batch_date) values($1,$2,current_date)',[oldShipment,oldCustomer]);await db.query('insert into shipment_lots values($1,$2)',[oldShipment,oldLot]);
  await db.exec(await read('../supabase/migrations/0032_freight_per_accumulated_shipment.sql'));
  assert.equal(await scalar('select count(*)::int from available_shipment_freight($1)',[oldCustomer]),0);
  await db.query('insert into customers(id,email) values($1,$2)',[customer,'fixture@example.invalid']);
  const first=crypto.randomUUID(),second=crypto.randomUUID(),third=crypto.randomUUID();
  await db.query("insert into lots(id,customer_id,status,auction_date,created_at) values($1,$3,'pending_payment','2026-10-13','2026-10-13'),($2,$3,'pending_payment','2026-10-20','2026-10-20')",[first,second,customer]);
  assert.equal(await scalar('select sum(freight_amount)::int from get_due_freight_periods($1)',[customer]),20);
  const charge=crypto.randomUUID();await db.query('insert into charges(id,customer_id) values($1,$2)',[charge,customer]);
  assert.equal(await scalar('select reserve_charge_freights($1,$2::uuid[])',[charge,[first,second]]),'20');
  assert.equal(await scalar('select amount::int from charges where id=$1',[charge]),80);
  await db.query("update charges set status='approved',paid_at=now() where id=$1",[charge]);await db.query("update lots set status='paid',charge_id=$1 where id=any($2::uuid[])",[charge,[first,second]]);
  // Mais um lote em outra semana, antes de consumir o frete: sem nova cobrança.
  await db.query("insert into lots(id,customer_id,status,auction_date) values($1,$2,'pending_payment','2026-10-27')",[third,customer]);
  assert.equal(await scalar('select count(*)::int from get_due_freight_periods($1)',[customer]),0);
  const charge2=crypto.randomUUID();await db.query('insert into charges(id,customer_id) values($1,$2)',[charge2,customer]);
  assert.equal(await scalar('select reserve_charge_freights($1,$2::uuid[])',[charge2,[third]]),'0');
  assert.equal(await scalar('select amount::int from charges where id=$1',[charge2]),30);
  await db.query("update charges set status='approved' where id=$1",[charge2]);await db.query("update lots set status='paid',charge_id=$1 where id=$2",[charge2,third]);
  const shipment=crypto.randomUUID();await db.query('insert into shipments(id,customer_id,batch_date) values($1,$2,current_date)',[shipment,customer]);
  await db.query('insert into shipment_lots select $1,unnest($2::uuid[])',[shipment,[first,second,third]]);
  await db.query('select bind_store_orders_to_shipment($1)',[shipment]);await db.query('select assert_shipment_freight($1)',[shipment]);
  assert.equal(await scalar('select count(*)::int from available_shipment_freight($1)',[customer]),0);
  await db.query("update shipments set status='cancelled' where id=$1",[shipment]);
  assert.equal(await scalar('select count(*)::int from available_shipment_freight($1)',[customer]),1);
  // Reutiliza a mesma taxa em uma nova etiqueta, sem pagar R$20 de novo.
  const retry=crypto.randomUUID();await db.query('insert into shipments(id,customer_id,batch_date) values($1,$2,current_date)',[retry,customer]);await db.query('insert into shipment_lots select $1,unnest($2::uuid[])',[retry,[first,second,third]]);await db.query('select bind_store_orders_to_shipment($1)',[retry]);
  const nextLot=crypto.randomUUID();await db.query("insert into lots(id,customer_id,status,auction_date) values($1,$2,'pending_payment','2026-10-27')",[nextLot,customer]);
  assert.equal(await scalar('select sum(freight_amount)::int from get_due_freight_periods($1)',[customer]),20);
  assert.equal((await db.query('select status from shipping_freight_states($1::uuid[])',[[customer]])).rows[0].status,'due');
  // Reembolso do frete bloqueia pagamento da etiqueta vinculada.
  await db.query("update charges set status='rejected' where id=$1",[charge]);await assert.rejects(db.query('select assert_shipment_freight($1)',[retry]),/pagamento do frete/);
  await db.exec(`set role authenticated;select set_config('test.customer','${customer}',false)`);
  const summary=await scalar('select get_customer_freight_summary()');assert.equal(summary.amount,20);
  await assert.rejects(db.query('select claim_shipment_freight($1)',[retry]),/permission denied/);
 }finally{await db.close();}
});
