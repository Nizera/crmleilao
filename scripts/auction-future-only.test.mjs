import {test} from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {loadCommerceDb,migration} from './fixtures/commerce-db.mjs';
test('prazo apenas para lotes novos: antigos não expiram nem recebem avisos após edição',async()=>{
 const db=new PGlite();const scalar=async(s,a=[])=>Object.values((await db.query(s,a)).rows[0])[0];const c=crypto.randomUUID();
 try{
  await loadCommerceDb(db);await db.exec("alter table lots add column if not exists moved_at timestamptz,add column if not exists paid_at timestamptz,add column if not exists updated_at timestamptz default now();create table if not exists lot_items(lot_id uuid,applied boolean default false);create table customer_notifications(id uuid primary key default gen_random_uuid(),customer_id uuid,kind text,title text,body text,href text,dedupe_key text unique)");
  await db.query("insert into customers(id,name,email) values($1,'Fixture','fixture@example.invalid')",[c]);
  const old=await scalar("insert into lots(id,customer_id,code,title,status,arremate_value,auction_date,created_at) values(gen_random_uuid(),$1,'OLD','Antigo','pending_payment',30,current_date,now()-interval '2 days') returning id",[c]);
  await db.exec(await migration('0062_auction_payment_deadlines.sql'));
  const fresh=await scalar("insert into lots(id,customer_id,code,title,status,arremate_value,auction_date,created_at) values(gen_random_uuid(),$1,'NEW','Novo','pending_payment',40,current_date,now()) returning id",[c]);
  const original=String(await scalar('select payment_due_at from lots where id=$1',[fresh]));
  await db.exec(await migration('0063_future_lots_only_deadlines.sql'));
  assert.equal(await scalar('select payment_due_at from lots where id=$1',[old]),null);assert.equal(String(await scalar('select payment_due_at from lots where id=$1',[fresh])),original);
  await db.query("update lots set title='Antigo editado' where id=$1",[old]);assert.equal(await scalar('select payment_due_at from lots where id=$1',[old]),null);
  assert.equal(await scalar('select expire_unpaid_auction_lot($1)',[old]),false);
  await scalar('select notify_auction_payment_deadlines()');assert.equal(Number(await scalar('select count(*) from customer_notifications')),0);
  const another=await scalar("insert into lots(id,customer_id,code,title,status,arremate_value,auction_date,created_at) values(gen_random_uuid(),$1,'NEXT','Mais novo','pending_payment',50,current_date,now()) returning id",[c]);
  assert.equal(Number(await scalar('select extract(epoch from(payment_due_at-created_at)) from lots where id=$1',[another])),86400);
  await db.exec(await migration('0063_future_lots_only_deadlines.sql'));assert.equal(await scalar('select payment_due_at from lots where id=$1',[old]),null);assert.equal(String(await scalar('select payment_due_at from lots where id=$1',[fresh])),original);
  assert.equal(await scalar('select status from lots where id=$1',[old]),'pending_payment');assert.equal(Number(await scalar('select arremate_value from lots where id=$1',[old])),30);
  // Recuperar mantém o cadastro original e reinicia prazo/avisos a partir de agora.
  await db.query("update lots set payment_due_at=now()-interval '1 hour',payment_reminded_at=now(),payment_last_warning_at=now() where id=$1",[fresh]);
  assert.equal(await scalar('select expire_unpaid_auction_lot($1)',[fresh]),true);
  await db.query("update lots set status='pending_payment' where id=$1",[fresh]);
  const recovered=(await db.query('select payment_expired_at,payment_reminded_at,payment_last_warning_at,charge_id,extract(epoch from (payment_due_at-now())) remaining from lots where id=$1',[fresh])).rows[0];
  assert.equal(recovered.payment_expired_at,null);assert.equal(recovered.payment_reminded_at,null);assert.equal(recovered.payment_last_warning_at,null);assert.equal(recovered.charge_id,null);assert.ok(Number(recovered.remaining)>86390&&Number(recovered.remaining)<=86400);
 }finally{await db.close();}
});
