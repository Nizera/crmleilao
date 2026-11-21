import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {loadCommerceDb,migration} from './fixtures/commerce-db.mjs';

test('rifas: taxa do elo, líquido pago, crédito único, retroativo, estorno, expiração e Caracoins gastos preservados',async()=>{
 const db=new PGlite(),a=crypto.randomUUID(),b=crypto.randomUUID(),history=crypto.randomUUID(),campaign=crypto.randomUUID();
 const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 try{
  await loadCommerceDb(db);
  await db.exec('alter table customers add column loyalty_rank_visible boolean default true;alter table lots add column loyalty_points_awarded numeric default 0;');
  await db.exec(await migration('0034_loyalty_rank_history.sql'));
  await db.exec(await migration('0058_caracoins_policy.sql'));
  await db.exec(await migration('0059_caracoins_expired_reversal.sql'));
  await db.query("insert into customers(id,name)values($1,'A'),($2,'B'),($3,'Histórico')",[a,b,history]);
  const actor=crypto.randomUUID();await db.query('insert into auth.users values($1)',[actor]);await db.query("insert into admin_profiles values($1,'owner')",[actor]);
  await db.query("insert into raffle_campaigns(id,title,description,total_numbers,unit_price,selection_mode,draw_method,draw_rules,hide_winning_numbers,min_quantity,max_quantity,status,created_by)values($1,'Rifa teste','Descrição teste',100,10,'both','external','Regras do sorteio',true,1,100,'draft',$2)",[campaign,actor]);
  let n=0;
  const order=async(customer,amount,status='paid')=>{
   const row=(await db.query('insert into raffle_orders(campaign_id,customer_id,request_key,amount,numbers,status,paid_at)values($1,$2,gen_random_uuid(),$3,$4,$5,now())returning id',[campaign,customer,amount,[n++],status])).rows[0];return row.id;
  };
  const old1=await order(history,1000),old2=await order(history,1000);
  await db.query("update raffle_orders set paid_at='2026-11-01' where id=$1",[old1]);await db.query("update raffle_orders set paid_at='2026-11-02' where id=$1",[old2]);
  await db.exec(readFileSync('supabase/releases/raffle_caracoins.sql','utf8'));
  await db.query("select set_config('test.customer',$1,false)",[a]);
  const first=await order(a,1000);await order(a,1000);await order(a,10);
  assert.equal(Number(await scalar('select get_customer_loyalty_balance()')),1010);
  assert.equal(Number(await scalar('select get_customer_loyalty_earned_points()')),1010);
  assert.equal(Number(await scalar("select count(*) from loyalty_ledger where customer_id=$1 and coin_event='welcome'",[a])),0,'raffle does not add auction welcome bonus');
  assert.ok((await db.query("select coins_expires_at>now()+interval '89 days' as valid from loyalty_ledger where customer_id=$1",[a])).rows.every(r=>r.valid));
  await db.query("update raffle_orders set status='paid' where id=$1",[first]);
  assert.equal(Number(await scalar('select get_customer_loyalty_balance()')),1010);
  const redemption=crypto.randomUUID();await db.query('insert into loyalty_redemptions(id)values($1)',[redemption]);
  await db.query("insert into loyalty_ledger(customer_id,points,kind,redemption_id)values($1,-100,'spent',$2)",[a,redemption]);
  await order(a,100);assert.equal(Number(await scalar('select get_customer_loyalty_balance()')),1010);
  assert.equal(Number(await scalar("select points from loyalty_ledger where redemption_id=$1",[redemption])),-100,'old spending is unchanged');
  const pending=await order(b,100,'pending');assert.equal(Number(await scalar('select count(*) from loyalty_ledger where raffle_order_id=$1',[pending])),0);
  await db.query("update raffle_orders set status='paid' where id=$1",[pending]);
  assert.equal(Number(await scalar("select points from loyalty_ledger where raffle_order_id=$1 and kind='earned'",[pending])),50);
  await assert.rejects(db.query('update raffle_orders set amount=200 where id=$1',[pending]),/já gerou/);
  await db.query("update loyalty_ledger set coins_expires_at=now()-interval '1 day',created_at=now()-interval '100 days' where raffle_order_id=$1",[pending]);
  await db.query("select set_config('test.customer',$1,false)",[b]);assert.equal(Number(await scalar('select get_customer_loyalty_balance()')),0);
  await db.query("update raffle_orders set status='review' where id=$1",[pending]);
  assert.equal(Number(await scalar('select get_customer_loyalty_balance()')),0,'expired credit reversal does not create a second debt');
  assert.equal(Number(await scalar('select get_customer_loyalty_earned_points()')),0,'ranking reversal remains full');
  await db.query("update raffle_orders set status='cancelled' where id=$1",[pending]);
  assert.equal(Number(await scalar("select count(*) from loyalty_ledger where raffle_order_id=$1 and kind='reversal'",[pending])),1);
  await db.exec(readFileSync('supabase/releases/raffle_caracoins_backfill.sql','utf8'));
  assert.equal(Number(await scalar("select sum(points) from loyalty_ledger where customer_id=$1 and kind='earned'",[history])),1000);
  const count=await scalar('select count(*) from loyalty_ledger');await db.exec(readFileSync('supabase/releases/raffle_caracoins_backfill.sql','utf8'));assert.equal(await scalar('select count(*) from loyalty_ledger'),count);
  for(const [rank,rate] of [[0,0.5],[1000,1],[5000,1.5],[15000,2],[25000,2.5],[50000,3]]){
   const id=crypto.randomUUID();await db.query("insert into customers(id,name)values($1,'Elo teste')",[id]);
   await db.query("insert into loyalty_rank_history(customer_id,source_key,paid_amount,rank_points,note)values($1,'test',0,$2,'Histórico sem moedas')",[id,rank]);
   const oid=await order(id,89.9);const row=(await db.query("select points,earn_rate,lot_value from loyalty_ledger where raffle_order_id=$1",[oid])).rows[0];
   assert.equal(Number(row.earn_rate),rate);assert.equal(Number(row.lot_value),89.9);assert.equal(Number(row.points),Math.round((89.9*rate+Number.EPSILON)*100)/100);
  }
  await db.query('update loyalty_settings set active=false');const inactive=await order(a,100);assert.equal(Number(await scalar('select count(*) from loyalty_ledger where raffle_order_id=$1',[inactive])),0);
  await db.query('update loyalty_settings set active=true');
  await db.query("update raffle_orders set status='cancelled' where id=$1",[first]);
  assert.equal(Number(await scalar("select points from loyalty_ledger where raffle_order_id=$1 and kind='reversal'",[first])),-500);
  await db.exec('set role authenticated');await assert.rejects(db.query('select credit_paid_raffle_caracoins($1)',[inactive]),/permission denied/);
  await db.exec('reset role;set role anon');await assert.rejects(db.query('select credit_paid_raffle_caracoins($1)',[inactive]),/permission denied/);
 }finally{await db.close();}
});
