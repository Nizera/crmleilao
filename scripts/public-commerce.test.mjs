import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import {createRequire} from 'node:module';import {PGlite} from '@electric-sql/pglite';const require=createRequire(import.meta.url);
test('retorno de login só aceita destinos internos de compra e descarta entradas perigosas',()=>{
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/commerce-access.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,URL,URLSearchParams,require:n=>require(n)});
 const safe=exports.safeCommerceNext;for(const value of ['https://evil.test','//evil.test','/\\evil.test','/admin','/painel/loja/../../admin','/painel/rifas/not-a-uuid','/painel/%2floja','/painel/loja\n','javascript:alert(1)'])assert.equal(safe(value),'/painel');
 assert.equal(safe('/painel/loja?resume=cart&access_token=secret'),'/painel/loja?resume=cart');assert.equal(safe('/painel/rifas/11111111-1111-4111-8111-111111111111?resume=raffle'),'/painel/rifas/11111111-1111-4111-8111-111111111111?resume=raffle');
});
test('leituras públicas não revelam rascunhos, cotas ocultas, compradores ou custos internos',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;
 create table loyalty_settings(id boolean,active boolean);
 create table loyalty_rewards(id uuid,name text,description text,delivery_kind text,points_cost numeric,stock integer,image_path text,image_paths text[],sku text,category text,cash_price numeric,created_at timestamptz,active boolean,archived boolean,mixed_cash_price numeric,mixed_points_cost numeric,internal_cost numeric);
 create table raffle_campaigns(id uuid,title text,description text,total_numbers integer,unit_price numeric,selection_mode text,draw_method text,draw_rules text,shipping_date date,image_url text,image_urls text[],hide_winning_numbers boolean,min_quantity integer,max_quantity integer,status text,created_at timestamptz,archived_at timestamptz,created_by uuid,private_note text);
 create table raffle_prizes(id uuid,campaign_id uuid,title text,kind text,number integer,image_urls text[]);
 create table raffle_orders(id uuid,status text,customer_id uuid);
 create table raffle_allocations(campaign_id uuid,number integer,order_id uuid);
 create table raffle_awards(prize_id uuid,number integer,result_note text,evidence_url text,order_id uuid,campaign_id uuid);
 insert into loyalty_settings values(true,true);
 insert into loyalty_rewards(id,name,delivery_kind,cash_price,active,archived,internal_cost) values('11111111-1111-4111-8111-111111111111','Produto público','physical',80,true,false,12),('22222222-2222-4222-8222-222222222222','Produto oculto','physical',10,false,false,2);
 insert into raffle_campaigns(id,title,total_numbers,unit_price,hide_winning_numbers,status,min_quantity,max_quantity,created_at,private_note) values('33333333-3333-4333-8333-333333333333','Campanha pública',100,10,true,'open',1,10,now(),'INTERNAL-SECRET'),('44444444-4444-4444-8444-444444444444','Rascunho secreto',100,10,true,'draft',1,10,now(),'SECRET');
 insert into raffle_prizes values('55555555-5555-4555-8555-555555555555','33333333-3333-4333-8333-333333333333','Prêmio surpresa','instant',7,'{}');
 insert into raffle_orders values('66666666-6666-4666-8666-666666666666','paid','77777777-7777-4777-8777-777777777777');
 insert into raffle_allocations values('33333333-3333-4333-8333-333333333333',1,'66666666-6666-4666-8666-666666666666');
 `);
 await db.exec(fs.readFileSync('supabase/migrations/0066_public_commerce.sql','utf8'));await db.exec('set role anon');
 const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const catalog=await scalar('select get_public_store_catalog()');assert.equal(catalog.total,1);assert.equal(catalog.items[0].cash_price,80);assert.equal('internal_cost' in catalog.items[0],false);
 const list=await scalar('select get_public_raffles()');assert.equal(list.total,1);assert.equal('private_note' in list.items[0],false);
 const detail=await scalar("select get_public_raffle_detail('33333333-3333-4333-8333-333333333333',0)");assert.equal(detail.prizes[0].number,null);assert.equal(detail.numbers[1].state,'paid');assert.equal(detail.paid,1);assert.equal('created_by' in detail.campaign,false);assert.equal('private_note' in detail.campaign,false);assert.ok(!JSON.stringify(detail).includes('77777777'));
 await assert.rejects(()=>scalar("select get_public_raffle_detail('44444444-4444-4444-8444-444444444444',0)"),/não encontrada/);
 await assert.rejects(()=>db.query('select * from raffle_orders'),/permission denied/);
 await db.exec('reset role');await db.exec("update raffle_campaigns set archived_at=now() where status='open'");await db.exec('set role anon');assert.equal((await scalar('select get_public_raffles()')).total,0);
 }finally{await db.close();}
});
