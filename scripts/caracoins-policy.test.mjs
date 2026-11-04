import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {loadCommerceDb,migration} from './fixtures/commerce-db.mjs';

test('política monetária: bônus único, FIFO, validade, isolamento e limite de vouchers',async t=>{
 const db=new PGlite();const a=crypto.randomUUID(),b=crypto.randomUUID(),old=crypto.randomUUID();
 const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 try{
  await loadCommerceDb(db);
  await db.exec('alter table customers add column loyalty_rank_visible boolean default true;alter table lots add column loyalty_points_awarded numeric default 0;');
  await db.exec(await migration('0034_loyalty_rank_history.sql'));
  await db.exec('create trigger award_points before update of status on lots for each row execute function award_lot_loyalty_points();');
  await db.query("insert into customers(id,name,email) values($1,'A','a@example.invalid'),($2,'B','b@example.invalid'),($3,'Antigo','old@example.invalid')",[a,b,old]);
  await db.query("insert into lots(id,customer_id,status,arremate_value) values($1,$2,'paid',100)",[crypto.randomUUID(),old]);
  await db.exec(await migration('0058_caracoins_policy.sql'));
  await db.exec(await migration('0059_caracoins_expired_reversal.sql'));
  const paidLot=async(customer,value)=>{const id=crypto.randomUUID();await db.query("insert into lots(id,customer_id,status,arremate_value) values($1,$2,'pending_payment',$3)",[id,customer,value]);await db.query("update lots set status='paid' where id=$1",[id]);return id;};
  await db.query("select set_config('test.customer',$1,false)",[a]);
  await t.test('primeira compra de R$ 1000 chega ao Bronze e reprocessar não duplica',async()=>{
   const first=await paidLot(a,1000);
   assert.equal(Number(await scalar('select get_customer_loyalty_balance()')),1000);
   assert.equal(Number(await scalar('select get_customer_loyalty_earned_points()')),1000);
   await db.query("update lots set status='paid' where id=$1",[first]);
   await paidLot(a,10);
   assert.equal(Number(await scalar("select count(*) from loyalty_ledger where customer_id=$1 and coin_event='welcome'",[a])),1);
   assert.equal(Number(await scalar('select get_customer_loyalty_earned_points()')),1010);
   await paidLot(old,10);
   assert.equal(Number(await scalar("select count(*) from loyalty_ledger where customer_id=$1 and coin_event='welcome'",[old])),0);
  });
  await t.test('cancelar primeira compra estorna bônus e não permite ganhá-lo outra vez',async()=>{
   const lot=await paidLot(b,100);
   await db.query("update lots set status='cancelled' where id=$1",[lot]);
   await db.query("select set_config('test.customer',$1,false)",[b]);
   assert.equal(Number(await scalar('select get_customer_loyalty_earned_points()')),0);
   assert.equal(Number(await scalar('select get_customer_loyalty_balance()')),0);
   await paidLot(b,100);
   assert.equal(Number(await scalar('select get_customer_loyalty_balance()')),50);
  });
  await t.test('preços são 500/1000/1500/2000 e o banco barra alterações fora da política',async()=>{
   const rows=(await db.query('select coins_cost,discount_cash from store_voucher_templates where active order by discount_cash')).rows;
   assert.deepEqual(rows.map(r=>[Number(r.coins_cost),Number(r.discount_cash)]),[[500,5],[1000,10],[1500,15],[2000,20]]);
   await assert.rejects(db.exec("insert into store_voucher_templates(name,coins_cost,discount_cash,active) values('Inválido',1,20,true)"),/voucher_policy_0058/);
   await assert.rejects(db.exec("insert into store_voucher_templates(name,coins_cost,discount_cash,active) values('Inválido',2500,25,true)"),/voucher_policy_0058/);
  });
  await t.test('FIFO preserva moedas novas, expira só saldo antigo e não reduz ranking',async()=>{
   await db.query("select set_config('test.customer',$1,false)",[a]);
   const rank=Number(await scalar('select get_customer_loyalty_earned_points()'));
   await db.query("update loyalty_ledger set coins_expires_at=now()-interval '1 second' where customer_id=$1 and points>0",[a]);
   await db.query("insert into loyalty_ledger(customer_id,points,kind,note) values($1,600,'adjustment','Novo crédito')",[a]);
   assert.equal(Number(await scalar('select get_customer_loyalty_balance()')),600);
   assert.equal(Number(await scalar('select get_customer_loyalty_earned_points()')),rank);
   await db.query("insert into loyalty_ledger(customer_id,points,kind,note) values($1,-100,'adjustment','Débito')",[a]);
   assert.equal(Number(await scalar('select get_customer_loyalty_balance()')),500);
   assert.equal(Number(await scalar("select count(*) from loyalty_ledger where customer_id=$1 and coin_event='expiry'",[a])),1);
   await db.query('select expire_customer_caracoins($1)',[a]);
   assert.equal(Number(await scalar("select count(*) from loyalty_ledger where customer_id=$1 and coin_event='expiry'",[a])),1);
  });
  await t.test('resgate consome saldo válido, um voucher desconta uma vez e idempotência não debita novamente',async()=>{
   await db.exec('update store_commerce_settings set purchases_enabled=true');
   const template=await scalar('select id from store_voucher_templates where active and discount_cash=5');const key=crypto.randomUUID();
   const voucher=await scalar('select redeem_store_voucher($1,$2)',[template,key]);
   assert.equal(Number(await scalar('select get_customer_loyalty_balance()')),0);
   assert.equal(await scalar('select redeem_store_voucher($1,$2)',[template,key]),voucher);
   await assert.rejects(db.query('select redeem_store_voucher($1,$2)',[template,crypto.randomUUID()]),/Saldo de Caracoins/);
   assert.equal(Number(await scalar('select get_customer_loyalty_balance()')),0);
  });
  await t.test('cancelamento após expiração não debita o mesmo benefício duas vezes',async()=>{
   const customer=crypto.randomUUID();await db.query("insert into customers(id,name,email) values($1,'Expirado','expiry@example.invalid')",[customer]);
   const lot=await paidLot(customer,100);
   await db.query("update loyalty_ledger set coins_expires_at=now()-interval '1 second' where customer_id=$1 and points>0",[customer]);
   await db.query('select expire_customer_caracoins($1)',[customer]);
   await db.query("update lots set status='cancelled' where id=$1",[lot]);
   await db.query("select set_config('test.customer',$1,false)",[customer]);
   assert.equal(Number(await scalar('select get_customer_loyalty_balance()')),0);
   assert.equal(Number(await scalar('select get_customer_loyalty_earned_points()')),0);
   await db.query("update lots set status='cancelled' where id=$1",[lot]);
   assert.equal(Number(await scalar('select get_customer_loyalty_balance()')),0);
   await db.query("select set_config('test.customer',$1,false)",[a]);
  });
  await t.test('outro cliente não consulta saldo nem executa sweep privado',async()=>{
   await db.exec('set role authenticated');
   await assert.rejects(db.query('select get_customer_loyalty_balance($1)',[b]),/Acesso negado/);
   await assert.rejects(db.query('select expire_due_caracoins()'),/permission denied/);
   await assert.rejects(db.query('select * from loyalty_welcome_claims'),/permission denied/);
   await db.exec('reset role');
  });
 }finally{await db.close();}
});
