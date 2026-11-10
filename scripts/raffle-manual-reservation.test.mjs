import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { loadCommerceDb, migration } from './fixtures/commerce-db.mjs';

test('ajustes de reservas exigem equipe, cotas próprias, Pix encerrado e auditoria', async () => {
 const db = new PGlite();
 try {
  await loadCommerceDb(db); await db.exec(await migration('0079_raffle_manual_reservation.sql'));
  const actor=crypto.randomUUID(), customer=crypto.randomUUID(), stranger=crypto.randomUUID();
  await db.query('insert into auth.users values($1)',[actor]);
  await db.query("insert into admin_profiles values($1,'owner'),($2,'viewer')",[actor,stranger]);
  await db.query("insert into customers(id,name,email) values($1,'Fixture','fixture@example.invalid')",[customer]);
  const campaign=(await db.query("insert into raffle_campaigns(title,description,total_numbers,unit_price,selection_mode,draw_method,draw_rules,created_by,max_quantity,status) values('Fixture','Regulamento de teste',10,10,'both','external','Sorteio externo',$1,10,'open') returning id",[actor])).rows[0].id;
  const make=async n=>{const o=(await db.query("insert into raffle_orders(campaign_id,customer_id,request_key,amount,numbers,status,mp_order_id) values($1,$2,gen_random_uuid(),10,array[$3::integer],'pending',$4) returning id",[campaign,customer,n,'ORD_fixture'+n])).rows[0].id;await db.query('insert into raffle_allocations values($1,$2,$3)',[campaign,n,o]);return o;};
  const adjust=(o,action,closed=true,who=actor)=>db.query('select manage_raffle_reservation($1,$2,$3,$4,$5)',[o,who,action,'Comprovante integral conferido pela equipe',closed]);
  await db.query("insert into raffle_prizes(campaign_id,title,kind,number) values($1,'Prêmio instantâneo','instant',0)",[campaign]);
  const a=await make(0);
  await db.exec('set role authenticated');await assert.rejects(adjust(a,'cancel'),/permission denied/);await db.exec('reset role');
  await assert.rejects(adjust(a,'cancel',true,stranger),/Acesso negado/);
  await assert.rejects(adjust(a,'paid_external',false),/Encerre o Pix/);
  await adjust(a,'paid_external');
  assert.equal((await db.query('select status from raffle_orders where id=$1',[a])).rows[0].status,'paid');
  assert.equal((await db.query('select count(*) from raffle_allocations where order_id=$1',[a])).rows[0].count,1);
  assert.equal((await db.query('select count(*) from raffle_awards where order_id=$1',[a])).rows[0].count,1);
  await assert.rejects(adjust(a,'cancel'),/reserva mudou/i);
  const b=await make(1);await adjust(b,'refund_confirmed',false);
  assert.equal((await db.query('select count(*) from raffle_allocations where order_id=$1',[b])).rows[0].count,0);
  const c=await make(2);await db.query('delete from raffle_allocations where order_id=$1',[c]);
  await assert.rejects(adjust(c,'paid_external'),/mais reservada/);
  assert.equal((await db.query("select count(*) from raffle_events where actor=$1 and action like 'Ajuste manual%'",[actor])).rows[0].count,2);
 } finally { await db.close(); }
});
