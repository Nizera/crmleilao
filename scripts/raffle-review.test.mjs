import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { loadCommerceDb } from './fixtures/commerce-db.mjs';

test('Rifa: resolução auditada de estorno e bloqueio de vendas após resultado',async t=>{
 const db=new PGlite(), actor=crypto.randomUUID(),customer=crypto.randomUUID();
 const value=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const owner=()=>db.exec('reset role');
 const service=async()=>{await owner();await db.exec('set role service_role');};
 try{
  await loadCommerceDb(db);await db.query('insert into auth.users values($1)',[actor]);await db.query("insert into admin_profiles values($1,'owner')",[actor]);
  await db.query("insert into customers(id,name,email) values($1,'Fixture','test@example.invalid')",[customer]);
  const campaign=await value("insert into raffle_campaigns(title,description,total_numbers,unit_price,selection_mode,draw_method,draw_rules,created_by,max_quantity,status) values('Fixture','Regulamento de teste',10,10,'both','external','Sorteio externo',$1,10,'paused') returning id",[actor]);
  const order=await value("insert into raffle_orders(campaign_id,customer_id,request_key,amount,numbers,status,mp_order_id) values($1,$2,gen_random_uuid(),20,array[0,1],'review','ORD_fixture') returning id",[campaign,customer]);
  const reference=await value('select external_reference from raffle_orders where id=$1',[order]);
  await db.query('insert into raffle_allocations values($1,0,$2),($1,1,$2)',[campaign,order]);
  const issue=await value("insert into logistics_pending(customer_id,title,quantity,reason,shipping_date,created_by,source_kind,cancelled_at) values($1,'Prêmio',1,'Rifa',current_date,$2,'raffle',now()) returning id",[customer,actor]);
  const prize=await value("insert into raffle_prizes(campaign_id,title,kind,number) values($1,'Prêmio instantâneo','instant',0) returning id",[campaign]);
  await db.query('insert into raffle_awards(prize_id,campaign_id,order_id,customer_id,number,logistics_id) values($1,$2,$3,$4,0,$5)',[prize,campaign,order,customer,issue]);
  const resolve=()=>db.query('select resolve_refunded_raffle($1,$2,$3,20,$4)',[order,'ORD_fixture',reference,actor]);
  await t.test('cliente não fornece prova de estorno nem executa resolução privada',async()=>{
   await db.exec('set role authenticated');await assert.rejects(resolve(),/permission denied/);
  });
  await t.test('resolução valida identidade/valor e preserva prêmios revelados',async()=>{
   await service();await assert.rejects(db.query('select resolve_refunded_raffle($1,$2,$3,19,$4)',[order,'ORD_fixture',reference,actor]),/divergente/);
   await resolve();await resolve();await owner();
   assert.equal(await value('select status from raffle_orders where id=$1',[order]),'cancelled');
   assert.deepEqual((await db.query('select number from raffle_allocations where order_id=$1 order by number',[order])).rows.map(x=>x.number),[0]);
   assert.ok(await value('select cancelled_at from logistics_pending where id=$1',[issue]));
   assert.equal(Number(await value("select count(*) from raffle_events where action like 'Estorno integral conferido:%'")),1);
  });
  await t.test('resultado principal impede reabrir campanha e novas reservas diretas',async()=>{
   await owner();const paid=await value("insert into raffle_orders(campaign_id,customer_id,request_key,amount,numbers,status) values($1,$2,gen_random_uuid(),10,array[2],'paid') returning id",[campaign,customer]);
   const logistics=await value("insert into logistics_pending(customer_id,title,quantity,reason,shipping_date,created_by,source_kind) values($1,'Quadro',1,'Rifa',current_date,$2,'raffle') returning id",[customer,actor]);
   const main=await value("insert into raffle_prizes(campaign_id,title,kind) values($1,'Quadro principal','main') returning id",[campaign]);
   await db.query('insert into raffle_awards(prize_id,campaign_id,order_id,customer_id,number,logistics_id) values($1,$2,$3,$4,2,$5)',[main,campaign,paid,customer,logistics]);
   await assert.rejects(db.query("update raffle_campaigns set status='open' where id=$1",[campaign]),/resultado principal/);
   await assert.rejects(db.query("insert into raffle_orders(campaign_id,customer_id,request_key,amount,numbers) values($1,$2,gen_random_uuid(),10,array[3])",[campaign,customer]),/resultado principal/);
   await db.query("update raffle_orders set status='review',mp_order_id='ORD_main' where id=$1",[paid]);
   const ref=await value('select external_reference from raffle_orders where id=$1',[paid]);await service();
   await assert.rejects(db.query('select resolve_refunded_raffle($1,$2,$3,10,$4)',[paid,'ORD_main',ref,actor]),/principal já apurado/);
  });
 }finally{await db.close();}
});
