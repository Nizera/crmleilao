import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('Ganhadores públicos: só revela cota e nome público depois de pagar, sem dados privados',async()=>{
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
 await db.exec(await readFile(new URL('../supabase/migrations/0073_raffle_public_instant_winners.sql',import.meta.url),'utf8'));
 const draft={title:'Rifa fixture',description:'Regulamento da campanha teste.',total_numbers:10,unit_price:10,selection_mode:'both',draw_method:'external',draw_rules:'Resultado externo com regra definida.',shipping_date:null,image_url:'',hide_winning_numbers:true,min_quantity:1,max_quantity:5};
 await as(admin);const campaign=await scalar('select save_raffle_campaign($1)',[draft]);
 await db.query("select manage_raffle($1,'main','Principal',1)",[campaign]);await db.query("select manage_raffle($1,'instant','Surpresa',2)",[campaign]);await db.query("select manage_raffle($1,'open',null,1)",[campaign]);await db.query('select set_raffle_purchases(true)');
 await db.exec('reset role');const prizes=(await db.query("select id,number from raffle_prizes where campaign_id=$1 and kind='instant' order by id",[campaign])).rows;
 await as('', 'anon');let state=await scalar('select get_public_raffle_number_states($1)',[campaign]);assert.deepEqual(state.instant_awards,[]);assert.ok(!JSON.stringify(state).includes('Cliente A'));
 await as(a);const order=await scalar('select reserve_raffle($1,$2,$3,null)',[campaign,crypto.randomUUID(),[prizes[0].number]]);
 await as('', 'anon');state=await scalar('select get_public_raffle_number_states($1)',[campaign]);assert.deepEqual(state.instant_awards,[]);
 await db.exec('reset role');const stored=(await db.query('select external_reference,amount from raffle_orders where id=$1',[order])).rows[0];
 await as('', 'service_role');await db.query("select settle_raffle_payment($1,'ORD_fixture',$2,'paid')",[stored.external_reference,stored.amount]);
 await as('', 'anon');state=await scalar('select get_public_raffle_number_states($1)',[campaign]);
 assert.deepEqual(state.instant_awards,[{prize_id:prizes[0].id,confirmed:true,number:prizes[0].number,winner_name:'Cliente A.'}]);
 assert.ok(!JSON.stringify(state).includes('example.invalid'));assert.ok(!JSON.stringify(state).includes('+550001'));assert.ok(!JSON.stringify(state).includes(a));
 await as('', 'service_role');await db.query("select settle_raffle_payment($1,'ORD_fixture',$2,'review')",[stored.external_reference,stored.amount]);
 await as('', 'anon');state=await scalar('select get_public_raffle_number_states($1)',[campaign]);assert.equal(state.instant_awards[0].confirmed,false);assert.equal(state.instant_awards[0].winner_name,null);assert.equal(state.instant_awards[0].number,null);
 await as(admin);await db.query("select manage_raffle($1,'pause',null,1)",[campaign]);await db.exec('reset role');await db.query('update raffle_campaigns set archived_at=now() where id=$1',[campaign]);
 await as('', 'anon');await assert.rejects(db.query('select get_public_raffle_number_states($1)',[campaign]),/não encontrada/);
 }finally{await db.close();}
});
