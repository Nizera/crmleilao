import {test} from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {loadCommerceDb,migration} from './fixtures/commerce-db.mjs';
test('prazo de 24h: tolerância, lembretes, isolamento e cancelamento sem perder pagamento',async t=>{
 const db=new PGlite();const scalar=async(s,a=[])=>Object.values((await db.query(s,a)).rows[0])[0];const c=crypto.randomUUID();
 const add=async({age=0,status='pending_payment',value=30}={})=>scalar("insert into lots(id,customer_id,code,title,status,arremate_value,auction_date,created_at) values(gen_random_uuid(),$1,gen_random_uuid()::text,'Fixture',$2,$3,current_date,now()-$4*interval '1 hour') returning id",[c,status,value,age]);
 const due=async(id,hours)=>db.query("update lots set payment_due_at=now()+$2*interval '1 hour' where id=$1",[id,hours]);
 try{
  await loadCommerceDb(db);await db.exec("alter table lots add column if not exists moved_at timestamptz,add column if not exists paid_at timestamptz,add column if not exists updated_at timestamptz default now();create table if not exists lot_items(lot_id uuid,applied boolean default false);create table customer_notifications(id uuid primary key default gen_random_uuid(),customer_id uuid,kind text,title text,body text,href text,dedupe_key text unique)");
  await db.query("insert into customers(id,name,email) values($1,'Fixture','fixture@example.invalid')",[c]);const legacy=await add({age:120}),zero=await add({value:0});
  await db.exec(await migration('0062_auction_payment_deadlines.sql'));
  await t.test('atuais recebem 24h; novos usam cadastro e zero reais não expira',async()=>{
   assert.ok(Number(await scalar('select extract(epoch from(payment_due_at-now())) from lots where id=$1',[legacy]))>86300);assert.equal(await scalar('select payment_due_at from lots where id=$1',[zero]),null);
   const fresh=await add({age:13});assert.ok(Math.abs(Number(await scalar('select extract(epoch from(payment_due_at-created_at)) from lots where id=$1',[fresh]))-86400)<1);
   await db.exec(await migration('0062_auction_payment_deadlines.sql'));assert.ok(Number(await scalar('select extract(epoch from(payment_due_at-now())) from lots where id=$1',[fresh]))<40000);
  });
  await t.test('lembrete de 12h e últimas 2h não se repetem; pagos e zero ficam fora',async()=>{
   await scalar('select notify_auction_payment_deadlines()');const count=Number(await scalar('select count(*) from customer_notifications'));assert.ok(count>0);await scalar('select notify_auction_payment_deadlines()');assert.equal(Number(await scalar('select count(*) from customer_notifications')),count);
   await due(legacy,1);await scalar('select notify_auction_payment_deadlines()');const last=Number(await scalar("select count(*) from customer_notifications where kind='lot_payment_last_warning'"));assert.equal(last,1);await scalar('select notify_auction_payment_deadlines()');assert.equal(Number(await scalar("select count(*) from customer_notifications where kind='lot_payment_last_warning'")),last);
  });
  await t.test('cancela somente vencidos sem Pix; repetições não geram novos avisos',async()=>{
   const id=await add();await due(id,-1);assert.equal(await scalar('select expire_unpaid_auction_lot($1)',[id]),true);assert.equal(await scalar('select expire_unpaid_auction_lot($1)',[id]),false);assert.equal(await scalar('select status from lots where id=$1',[id]),'cancelled');assert.ok(await scalar('select payment_expired_at from lots where id=$1',[id]));
   assert.equal(Number(await scalar("select count(*) from customer_notifications where kind='lot_payment_expired' and dedupe_key like $1",['auction_expired:'+id+':%'])),1);
   const paid=await add({status:'paid'});await due(paid,-1);assert.equal(await scalar('select expire_unpaid_auction_lot($1)',[paid]),false);
   await due(zero,-1);assert.equal(await scalar('select expire_unpaid_auction_lot($1)',[zero]),false);
  });
  await t.test('Pix aberto protege lotes; encerrar Pix cancela só o antigo e mantém o novo',async()=>{
   const old=await add(),recent=await add(),charge=crypto.randomUUID();await due(old,-1);await due(recent,3);
   await db.exec('alter table charges add column if not exists mp_payment_id text,add column if not exists external_reference text');
   await db.query("insert into charges(id,customer_id,status,amount,mp_payment_id,external_reference) values($1,$2,'pending',60,'ORD_fixture','REF_fixture')",[charge,c]);
   await db.query('update lots set charge_id=$1 where id=$2',[charge,recent]);await assert.rejects(db.query('update lots set charge_id=$1 where id=$2',[charge,old]),/prazo/);
   // Simula vínculo feito antes do vencimento.
   await due(old,1);await db.query('update lots set charge_id=$1 where id=$2',[charge,old]);await due(old,-1);
   assert.equal(await scalar('select expire_unpaid_auction_lot($1)',[old]),false);
   assert.equal(await scalar("select release_closed_auction_charge($1,'ORD_fixture','REF_fixture',60,'cancelled')",[charge]),false);
   await db.query("update charges set status='cancelled' where id=$1",[charge]);assert.equal(await scalar("select release_closed_auction_charge($1,'OUTRO','REF_fixture',60,'cancelled')",[charge]),false);
   assert.equal(await scalar("select release_closed_auction_charge($1,'ORD_fixture','REF_fixture',60,'cancelled')",[charge]),true);assert.equal(await scalar('select expire_unpaid_auction_lot($1)',[old]),true);assert.equal(await scalar('select expire_unpaid_auction_lot($1)',[recent]),false);assert.equal(await scalar('select status from lots where id=$1',[recent]),'pending_payment');
  });
  await t.test('estoque já movimentado e cliente sem permissão não sofrem baixa automática',async()=>{
   const id=await add();await due(id,-1);await db.query('update lots set moved_at=now() where id=$1',[id]);assert.equal(await scalar('select expire_unpaid_auction_lot($1)',[id]),false);
   await db.exec('set role authenticated');await assert.rejects(db.query('select expire_unpaid_auction_lot($1)',[id]),/permission denied/);await assert.rejects(db.query('select notify_auction_payment_deadlines()'),/permission denied/);await assert.rejects(db.query('select claim_auction_payment_expirations(5)'),/permission denied/);await db.exec('reset role');
  });
 }finally{await db.close();}
});
