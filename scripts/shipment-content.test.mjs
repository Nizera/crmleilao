import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { loadCommerceDb } from './fixtures/commerce-db.mjs';

test('Pacote: prêmios declarados, snapshot exato e proteção contra alterações concorrentes', async t => {
  const db = new PGlite(); const customer = crypto.randomUUID(), actor = crypto.randomUUID();
  const scalar = async (sql, args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
  const owner = () => db.exec('reset role');
  const staff = async () => { await owner(); await db.query("select set_config('test.actor',$1,false)",[actor]); await db.exec("set role authenticated;select set_config('test.admin','true',false)"); };
  const service = async () => { await owner(); await db.exec('set role service_role'); };
  const createShipment = async value => { await owner(); return scalar('insert into shipments(customer_id,batch_date,insurance_value) values($1,current_date,$2) returning id',[customer,value]); };
  const bind = async (id,expected) => { await service(); return scalar('select bind_shipment_contents($1,$2::jsonb)',[id,JSON.stringify(expected)]); };
  try {
    await loadCommerceDb(db);
    await db.query('insert into auth.users values($1)',[actor]);await db.query("insert into admin_profiles values($1,'owner')",[actor]);
    await db.query("insert into customers(id,name,email) values($1,'Fixture','test@example.invalid')",[customer]);
    await db.query("insert into charges(customer_id,status,freight_amount,freight_period) values($1,'approved',20,current_date)",[customer]);
    const product = await scalar("insert into loyalty_rewards(name,cash_price,stock,internal_cost,active) values('Produto',80,10,1,true) returning id");
    const order = await scalar("insert into store_orders(customer_id,request_key,external_reference,cash_total,coins_total,payment_status,fulfillment_status) values($1,gen_random_uuid(),'shop_'||gen_random_uuid(),80,0,'paid','processing') returning id",[customer]);
    await db.query("insert into store_order_items(order_id,reward_id,name,quantity,price_mode,unit_cash,unit_coins,reserved_stock) values($1,$2,'Produto',1,'cash',80,0,true)",[order,product]);
    await staff();await db.query('select box_store_order($1)',[order]);
    await owner();const issue = await scalar("insert into logistics_pending(customer_id,title,quantity,reason,shipping_date,created_by,source_kind) values($1,'Prêmio',1,'Rifa: Fixture',current_date,$2,'raffle') returning id",[customer,actor]);
    const campaign=await scalar("insert into raffle_campaigns(title,description,total_numbers,unit_price,selection_mode,draw_method,draw_rules,created_by,max_quantity) values('Fixture','Regulamento de teste',10,10,'both','external','Regra externa',$1,10) returning id",[actor]);
    const raffleOrder=await scalar("insert into raffle_orders(campaign_id,customer_id,request_key,amount,numbers,status) values($1,$2,gen_random_uuid(),10,array[0],'paid') returning id",[campaign,customer]);
    const prize=await scalar("insert into raffle_prizes(campaign_id,title,kind,number) values($1,'Prêmio','instant',0) returning id",[campaign]);
    await db.query('insert into raffle_awards(prize_id,campaign_id,order_id,customer_id,number,logistics_id) values($1,$2,$3,$4,0,$5)',[prize,campaign,raffleOrder,customer,issue]);
    await t.test('valor do prêmio é obrigatório e RPC antiga não contorna a conferência',async()=>{
      await staff();await assert.rejects(db.query('select box_raffle_award($1,0)',[issue]),/valor declarado/);
      await assert.rejects(db.query("select handle_logistics_pending($1,'box')",[issue]),/valor declarado/);
      await db.query('select box_raffle_award($1,50)',[issue]);await db.query('select box_raffle_award($1,999)',[issue]);
      assert.equal(Number(await scalar('select shipping_declared_value from logistics_pending where id=$1',[issue])),50);
    });
    const expected = {lots:[],store:[{id:order,value:80}],logistics:[{id:issue,value:50}]};
    await t.test('cliente/viewer não separa prêmio nem usa vínculo privado',async()=>{
      await owner();await db.exec("set role authenticated;select set_config('test.admin','false',false)");
      await assert.rejects(db.query('select box_raffle_award($1,10)',[issue]),/Acesso negado/);
      await assert.rejects(db.query('select bind_shipment_contents(gen_random_uuid(),$1)',[JSON.stringify(expected)]),/permission denied/);
    });
    await t.test('vínculo exige mesmo valor declarado e seguro inclui o prêmio',async()=>{
      const shipment = await createShipment(80);
      await assert.rejects(bind(shipment,expected),/seguro/);
      await owner();assert.equal(await scalar('select shipment_id from store_orders where id=$1',[order]),null);
      await db.query('update shipments set insurance_value=130 where id=$1',[shipment]);await bind(shipment,expected);
      await owner();assert.equal(await scalar('select shipment_id from logistics_pending where id=$1',[issue]),shipment);
      assert.deepEqual(await scalar('select content_snapshot from shipments where id=$1',[shipment]),expected);
      assert.equal(await bind(shipment,expected),0);
      await owner();await db.query("update shipments set status='cancelled' where id=$1",[shipment]);
      assert.equal(await scalar('select shipment_id from logistics_pending where id=$1',[issue]),null);
    });
    await t.test('novo pedido na caixa durante emissão aborta snapshot antigo sem vincular recursos',async()=>{
      await owner();const second = await scalar("insert into store_orders(customer_id,request_key,external_reference,cash_total,coins_total,payment_status,fulfillment_status) values($1,gen_random_uuid(),'shop_'||gen_random_uuid(),80,0,'paid','processing') returning id",[customer]);
      await db.query("insert into store_order_items(order_id,reward_id,name,quantity,price_mode,unit_cash,unit_coins,reserved_stock) values($1,$2,'Produto 2',1,'cash',80,0,true)",[second,product]);
      await staff();await db.query('select box_store_order($1)',[second]);
      const shipment=await createShipment(130);await assert.rejects(bind(shipment,expected),/conteúdo do pacote mudou/);
      await owner();assert.equal(Number(await scalar('select count(*) from store_orders where shipment_id=$1',[shipment])),0);
      assert.equal(await scalar('select content_snapshot from shipments where id=$1',[shipment]),null);
      const next={...expected,store:[...expected.store,{id:second,value:80}]};
      await db.query('update shipments set insurance_value=210 where id=$1',[shipment]);await bind(shipment,next);
      await owner();assert.equal(Number(await scalar('select count(*) from store_orders where shipment_id=$1',[shipment])),2);
    });
    await t.test('estorno após vínculo bloqueia etiqueta e não reativa prêmio ao cancelar envio',async()=>{
      await owner();const shipment=await scalar('select shipment_id from logistics_pending where id=$1',[issue]);
      await service();await db.query('select assert_shipment_raffle_payments($1)',[shipment]);
      await owner();await db.query("update raffle_orders set status='review' where id=$1",[raffleOrder]);
      await service();await assert.rejects(db.query('select assert_shipment_raffle_payments($1)',[shipment]),/pagamento em análise/);
      await owner();assert.equal(await scalar('select cancelled_at from logistics_pending where id=$1',[issue]),null);
      await db.query("update shipments set status='cancelled' where id=$1",[shipment]);
      assert.equal(await scalar('select shipment_id from logistics_pending where id=$1',[issue]),null);
      assert.ok(await scalar('select cancelled_at from logistics_pending where id=$1',[issue]));
      await staff();await assert.rejects(db.query('select box_raffle_award($1,50)',[issue]),/indisponível/);
    });
  } finally { await db.close(); }
});
