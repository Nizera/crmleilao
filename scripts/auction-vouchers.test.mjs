import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {loadCommerceDb,migration} from './fixtures/commerce-db.mjs';

test('voucher da rifa aplicado no cadastro do lote: saldo, cancelamento, segurança e frete',async t=>{
 const db=new PGlite(),actor=crypto.randomUUID(),customer=crypto.randomUUID(),other=crypto.randomUUID();
 const v=async(sql,p=[])=>Object.values((await db.query(sql,p)).rows[0])[0];
 try{
  await loadCommerceDb(db);
  await db.exec(`alter table lots add column discount_amount numeric not null default 0,add column paid_at timestamptz,add column moved_at timestamptz;
   alter table raffle_campaigns add column archived_at timestamptz,add column image_urls text[] not null default '{}',add column price_tiers jsonb not null default '[]';
   alter table raffle_prizes add column image_urls text[] not null default '{}';
   create table lot_freight_waivers(lot_id uuid primary key,customer_id uuid);
  `);
  for(const name of ['0050_external_prize_freight_release.sql','0077_mixed_prize_freight.sql','0080_company_prize_replacement_freight.sql','0086_duplicate_raffle_campaign.sql','0091_raffle_top_buyer.sql'])await db.exec(await migration(name));
  await db.query('insert into auth.users values($1)',[actor]);await db.query("insert into admin_profiles values($1,'owner')",[actor]);
  await db.query("select set_config('test.actor',$1,false),set_config('test.admin','true',false)",[actor]);
  await db.query("insert into customers(id,name)values($1,'Cliente Teste'),($2,'Outro Cliente')",[customer,other]);
  await db.exec(await readFile('supabase/releases/auction_vouchers.sql','utf8'));
  const campaign=crypto.randomUUID();
  await db.query("insert into raffle_campaigns(id,title,description,total_numbers,unit_price,selection_mode,draw_method,draw_rules,hide_winning_numbers,min_quantity,max_quantity,status,created_by)values($1,'Rifa teste','Descrição de teste',100,10,'both','external','Regras de teste',true,1,100,'draft',$2)",[campaign,actor]);
  await db.query("select set_raffle_buyer_bonus($1,'Voucher de leilão','voucher',50,0)",[campaign]);
  await db.query("insert into raffle_orders(campaign_id,customer_id,request_key,amount,numbers,status,paid_at)values($1,$2,gen_random_uuid(),10,array[1],'paid',now())",[campaign,customer]);
  await db.query("update raffle_campaigns set status='closed' where id=$1",[campaign]);
  const voucher=await v('select id from auction_vouchers where campaign_id=$1',[campaign]);
  const remaining=async()=>Number(await v('select remaining from auction_vouchers where id=$1',[voucher]));
  const create=async(net,credit,c=customer)=>v("insert into lots(id,customer_id,status,arremate_value,discount_amount,voucher_amount,auction_voucher_id,auction_date,shipping_date)values(gen_random_uuid(),$1,'pending_payment',$2,$3,$3,$4,current_date,current_date) returning id",[c,net,credit,voucher]);
  let first;
  await t.test('lotes sem voucher continuam aceitando cadastro, edição e remoção',async()=>{
   const id=await v("insert into lots(id,customer_id,arremate_value,status)values(gen_random_uuid(),$1,0,'paid')returning id",[other]);
   await db.query("update lots set title='Reposição' where id=$1",[id]);
   await db.query('delete from lots where id=$1',[id]);
   assert.equal(await remaining(),50);
  });
  await t.test('encerrar rifa emite crédito uma única vez, visível ao cliente',async()=>{
   assert.ok(voucher);assert.equal(await remaining(),50);
   assert.equal(await v('select status from raffle_buyer_results where campaign_id=$1',[campaign]),'fulfilled');
   await db.query("select set_config('test.customer',$1,false)",[customer]);
   const mine=await v('select get_my_raffle_buyer_bonuses()');assert.equal(mine[0].voucher_issued,true);assert.equal(Number(mine[0].voucher_available),50);
   await db.query('select finalize_raffle_buyer_bonus($1)',[campaign]);assert.equal(Number(await v('select count(*) from auction_vouchers')),1);
  });
  await t.test('reserva parcial, edição, cancelamento e reabertura atualizam o saldo sem duplicar',async()=>{
   first=await create(70,30);assert.equal(await remaining(),20);
   await assert.rejects(create(70,30),/Saldo.*insuficiente/);assert.equal(await remaining(),20);
   await db.query('update lots set arremate_value=80,discount_amount=20,voucher_amount=20 where id=$1',[first]);assert.equal(await remaining(),30);
   await db.query("update lots set status='cancelled' where id=$1",[first]);assert.equal(await remaining(),50);
   await db.query("update lots set status='pending_payment' where id=$1",[first]);assert.equal(await remaining(),30);
   await assert.rejects(db.query('update lots set customer_id=$1 where id=$2',[other,first]),/este cliente/);assert.equal(await remaining(),30);
   await db.query("update lots set status='cancelled' where id=$1",[first]);
  });
  await t.test('cobertura total não gera Pix de zero e continua exigindo frete de arremate',async()=>{
   const full=await create(0,50);assert.equal(await remaining(),0);
   assert.equal(await v('select status from lots where id=$1',[full]),'paid');
   assert.equal(await v('select paid_at from lots where id=$1',[full]),null);
   assert.equal(Number(await v('select count(*) from charges')),0);
   assert.equal(Number(await v('select sum(freight_amount) from get_due_freight_periods($1)',[customer])),20);
   const shipment=await v('insert into shipments(customer_id,batch_date)values($1,current_date) returning id',[customer]);await db.query('insert into shipment_lots values($1,$2)',[shipment,full]);
   assert.equal(await v('select is_company_prize_package($1)',[shipment]),false);
   await assert.rejects(db.query('select claim_shipment_freight($1)',[shipment]),/frete/);
   await db.query("update shipments set status='cancelled' where id=$1",[shipment]);
   await db.query('update lots set arremate_value=10,discount_amount=40,voucher_amount=40 where id=$1',[full]);
   assert.equal(await v('select status from lots where id=$1',[full]),'pending_payment');assert.equal(await remaining(),10);
   await db.query("update lots set status='cancelled' where id=$1",[full]);assert.equal(await remaining(),50);
  });
  await t.test('Pix aberto, pagamento confirmado e voucher em revisão bloqueiam alterações financeiras',async()=>{
   const id=await create(60,40),charge=await v('insert into charges(customer_id) values($1) returning id',[customer]);
   await db.query('update lots set charge_id=$1 where id=$2',[charge,id]);
   await assert.rejects(db.query('update lots set voucher_amount=30 where id=$1',[id]),/Pix/);
   await db.query("update lots set charge_id=null,status='paid',paid_at=now() where id=$1",[id]);
   await assert.rejects(db.query("update lots set status='cancelled' where id=$1",[id]),/pagamento/);assert.equal(await remaining(),10);
   await db.query("update raffle_buyer_results set status='review' where campaign_id=$1",[campaign]);
   await assert.rejects(create(1,1),/revisão/);
   assert.equal((await v('select get_auction_vouchers($1,null)',[customer])).length,0);
  });
  await t.test('cliente não emite nem altera crédito; consulta restringe-se ao próprio saldo',async()=>{
   await db.exec('grant select,insert on lots to authenticated');
   await db.exec("set role authenticated;select set_config('test.admin','false',false)");
   await assert.rejects(create(1,1),/Acesso negado/);
   await assert.rejects(db.query('update auction_vouchers set remaining=50'),/permission denied/);
   await assert.rejects(db.query('select get_auction_vouchers($1,null)',[other]),/Acesso negado/);
   await assert.rejects(db.query('select issue_raffle_auction_voucher()'),/permission denied/);
  });
 }finally{await db.close();}
});
