import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { loadCommerceDb, migration } from './fixtures/commerce-db.mjs';

test('duplicação cria rascunho isolado, copia configuração e prêmios principais, sem cotas ou vendas', async () => {
 const db = new PGlite();
 try {
  await loadCommerceDb(db);
  await db.exec(`alter table raffle_campaigns add column image_urls text[] not null default '{}', add column price_tiers jsonb not null default '[]', add column archived_at timestamptz;
   alter table raffle_prizes add column image_urls text[] not null default '{}';
   create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;`);
  await db.exec(await migration('0086_duplicate_raffle_campaign.sql'));
  const actor='10000000-0000-4000-8000-000000000001',source='20000000-0000-4000-8000-000000000001',customer='30000000-0000-4000-8000-000000000001',order='40000000-0000-4000-8000-000000000001',request='50000000-0000-4000-8000-000000000001';
  await db.query("insert into auth.users values($1);",[actor]);
  await db.query("insert into admin_profiles values($1,'owner')",[actor]);
  await db.query("select set_config('test.actor',$1,false),set_config('test.admin','true',false)",[actor]);
  await db.query(`insert into raffle_campaigns(id,title,description,total_numbers,unit_price,selection_mode,draw_method,draw_rules,shipping_date,image_url,image_urls,hide_winning_numbers,min_quantity,max_quantity,price_tiers,status,created_by,archived_at)
   values($1,'Campanha original','Descrição original para teste',50,10,'both','external','Regras originais para teste','2026-11-10','https://example.com/cover.webp',array['https://example.com/photo.webp'],true,1,20,'[{"min_quantity":5,"unit_price":8}]','closed',$2,now())`,[source,actor]);
  await db.query(`insert into raffle_prizes(campaign_id,title,kind,number,image_urls) values($1,'1º PRÊMIO','main',null,array['https://example.com/prize.webp']),($1,'Cota surpresa','instant',7,'{}')`,[source]);
  await db.query('insert into customers(id,name) values($1,$2)',[customer,'Cliente']);
  await db.query(`insert into raffle_orders(id,campaign_id,customer_id,request_key,amount,numbers,status) values($1,$2,$3,gen_random_uuid(),10,array[7],'paid')`,[order,source,customer]);
  await db.query('insert into raffle_allocations values($1,7,$2)',[source,order]);
  const copy=async(key=request)=> (await db.query('select duplicate_raffle_campaign($1,$2) id',[source,key])).rows[0].id;
  const id=await copy(); assert.notEqual(id,source);assert.equal(await copy(),id);
  const row=(await db.query('select * from raffle_campaigns where id=$1',[id])).rows[0];
  assert.equal(row.status,'draft');assert.equal(row.title,'Campanha original (cópia)');assert.equal(row.shipping_date,null);assert.equal(row.archived_at,null);assert.equal(row.total_numbers,50);assert.equal(Number(row.unit_price),10);assert.deepEqual(row.price_tiers,[{min_quantity:5,unit_price:8}]);assert.deepEqual(row.image_urls,['https://example.com/photo.webp']);
  const prizes=(await db.query('select * from raffle_prizes where campaign_id=$1',[id])).rows;assert.equal(prizes.length,1);assert.equal(prizes[0].kind,'main');assert.equal(prizes[0].number,null);assert.deepEqual(prizes[0].image_urls,['https://example.com/prize.webp']);
  for(const table of ['raffle_orders','raffle_allocations','raffle_awards'])assert.equal((await db.query(`select count(*)::int n from ${table} where campaign_id=$1`,[id])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from raffle_allocations where campaign_id=$1',[source])).rows[0].n,1);
  await db.exec("set role authenticated;select set_config('test.admin','false',false)");await assert.rejects(copy(),/Acesso negado/);
  await db.exec("select set_config('test.admin','true',false);select set_config('test.readonly','true',false)");await assert.rejects(copy(),/Acesso negado/);
  await db.exec("reset role;select set_config('test.readonly','false',false)");
  await db.query("update raffle_campaigns set status='open' where id=$1",[source]);await assert.rejects(copy('50000000-0000-4000-8000-000000000002'),/Somente campanhas encerradas/);
 } finally { await db.close(); }
});
