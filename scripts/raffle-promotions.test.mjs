import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';
const pricing=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(await readFile(new URL('../src/lib/raffle-pricing.ts',import.meta.url),'utf8'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('Promoções: faixas, centavos e validação',()=>{
 const tiers=[{min_quantity:5,unit_price:8},{min_quantity:10,unit_price:7.5}];
 assert.deepEqual(pricing.validateRafflePriceTiers(tiers,10,100),tiers);
 for(const [qty,total] of [[4,40],[5,40],[6,48],[10,75],[11,82.5]])assert.equal(pricing.rafflePriceQuote(10,tiers,qty).total,total);
 assert.equal(pricing.rafflePriceQuote(.3,[{min_quantity:5,unit_price:.1}],6).total,.6);
 for(const rows of [[{min_quantity:5,unit_price:0}],[{min_quantity:5,unit_price:10}],[{min_quantity:5,unit_price:8.001}],[{min_quantity:5,unit_price:8},{min_quantity:5,unit_price:7}],[{min_quantity:5,unit_price:8},{min_quantity:10,unit_price:9}]])assert.throws(()=>pricing.validateRafflePriceTiers(rows,10,100));
});
test('Banco: promoção segura e reserva com preço congelado',async()=>{
 const db=new PGlite();const admin=crypto.randomUUID(),viewer=crypto.randomUUID(),a=crypto.randomUUID(),b=crypto.randomUUID();
 const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const as=async(id,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('test.uid',$1,false)",[id]);await db.exec(`set role ${role}`);};
 try{
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; grant usage on schema auth,public to anon,authenticated,service_role;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create table admin_profiles(id uuid primary key,role text);
      create table customers(id uuid primary key,auth_user_id uuid,name text,email text,phone_e164 text);
      create function public.current_customer_id() returns uuid language sql stable security definer as $$select id from public.customers where auth_user_id=auth.uid()$$;
      create function public.is_admin() returns boolean language sql stable security definer as $$select exists(select 1 from public.admin_profiles where id=auth.uid())$$;
      create function public.has_staff_write() returns boolean language sql stable security definer as $$select exists(select 1 from public.admin_profiles where id=auth.uid() and role in ('owner','staff'))$$;
      create table shipments(id uuid primary key,tracking_code text,status text);
      create table logistics_pending(id uuid primary key default gen_random_uuid(),customer_id uuid references customers(id),title text,quantity int,reason text,shipping_date date,created_by uuid references admin_profiles(id),moved_at timestamptz,shipment_id uuid references shipments(id),cancelled_at timestamptz);
    `);
    await db.query("insert into admin_profiles values($1,'owner'),($2,'viewer')", [admin, viewer]);
    await db.query("insert into customers values($1,$1,'Cliente A','a@example.invalid','+550001'),($2,$2,'Cliente B','b@example.invalid','+550002')", [a, b]);
    const baseMigration = await readFile(new URL('../supabase/migrations/0043_raffles.sql', import.meta.url), 'utf8');
    assert.ok(baseMigration.trim().length > 100, 'A migration 0043 está vazia: recupere a versão original antes de testar.');
    await db.exec(baseMigration);
    await db.exec(await readFile(new URL('../supabase/migrations/0044_raffle_optional_shipping_date.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/0052_raffle_photos.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/0053_raffle_close_after_results.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/0054_raffle_optional_result_link.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/0055_raffle_pause_when_paid_out.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/0056_raffle_reservation_ten_minutes.sql', import.meta.url), 'utf8'));

 await db.exec('alter table raffle_campaigns add column if not exists archived_at timestamptz');
 await db.exec(await readFile(new URL('../supabase/migrations/0071_raffle_quantity_promotions.sql',import.meta.url),'utf8'));
 const draft={title:'Promoção teste',description:'Regulamento da campanha teste.',total_numbers:100,unit_price:10,selection_mode:'both',draw_method:'external',draw_rules:'Resultado externo com regra definida.',shipping_date:null,image_url:'',hide_winning_numbers:true,min_quantity:1,max_quantity:50};
 const tiers=[{min_quantity:5,unit_price:8},{min_quantity:10,unit_price:7.5}];
 await as(a);await assert.rejects(scalar('select save_raffle_campaign_with_promotions($1,$2)',[draft,tiers]),/Acesso negado/);
 await as(admin);const c=await scalar('select save_raffle_campaign_with_promotions($1,$2)',[draft,tiers]);
 await db.query("select manage_raffle($1,'main','Prêmio',1)",[c]);await db.query("select manage_raffle($1,'open',null,1)",[c]);await db.query('select set_raffle_purchases(true)');
 await assert.rejects(db.query('select set_raffle_price_tiers($1,$2,$2)',[c,tiers]),/Pause/);
 await as('', 'anon');const publicState=await scalar('select get_public_raffle_number_states($1)',[c]);assert.equal(publicState.price_tiers[0].unit_price,8);assert.deepEqual(Object.keys(publicState).sort(),['occupied','price_tiers','total','unit_price']);
 await assert.rejects(db.query('select set_raffle_price_tiers($1,$2,$2)',[c,tiers]),/permission denied/);
 await as(a);const key=crypto.randomUUID();await assert.rejects(scalar('select reserve_raffle_at_price($1,$2,null,6,1,1)',[c,key]),/mudou/);
 const id=await scalar('select reserve_raffle_at_price($1,$2,null,6,48,8)',[c,key]);
 let order=(await db.query('select * from raffle_orders where id=$1',[id])).rows[0];assert.equal(Number(order.amount),48);assert.equal(Number(order.discount_amount),12);assert.equal(order.numbers.length,6);assert.equal(order.price_tier_min,5);
 await as(b);const manual=await scalar('select reserve_raffle_at_price($1,$2,$3,null,75,7.5)',[c,crypto.randomUUID(),Array.from({length:100},(_,i)=>i).filter(i=>!order.numbers.includes(i)).slice(0,10)]);assert.equal(Number(await scalar('select amount from raffle_orders where id=$1',[manual])),75);
 await as(admin);await db.query("select manage_raffle($1,'pause',null,1)",[c]);
 await assert.rejects(db.query('select set_raffle_price_tiers($1,$2,$3)',[c,[{min_quantity:5,unit_price:0}],tiers]),/Revise/);
 await db.query('select set_raffle_price_tiers($1,$2,$3)',[c,[{min_quantity:5,unit_price:7}],tiers]);
 await assert.rejects(db.query('select set_raffle_price_tiers($1,$2,$3)',[c,[],tiers]),/mudaram/);
 await as(a);assert.equal(await scalar('select reserve_raffle_at_price($1,$2,null,6,48,8)',[c,key]),id);assert.equal(Number(await scalar('select amount from raffle_orders where id=$1',[id])),48);
 await as(viewer);await assert.rejects(db.query('select set_raffle_price_tiers($1,$2,$3)',[c,[],[]]),/Acesso negado/);
 await db.exec('reset role');assert.equal(Number(await scalar('select count(*) from raffle_orders')),2);
 for(const qty of [4,5,6,10,11]) {
  await as(admin);const campaign=await scalar('select save_raffle_campaign_with_promotions($1,$2)',[draft,tiers]);
  await db.query("select manage_raffle($1,'main','Premio',1)",[campaign]);await db.query("select manage_raffle($1,'open',null,1)",[campaign]);
  await as(a);const quote=pricing.rafflePriceQuote(10,tiers,qty);
  const reserved=await scalar('select reserve_raffle_at_price($1,$2,null,$3,$4,$5)',[campaign,crypto.randomUUID(),qty,quote.total,quote.unit_price]);
  assert.equal(Number(await scalar('select amount from raffle_orders where id=$1',[reserved])),quote.total);
 }
 }finally{await db.close();}
});
