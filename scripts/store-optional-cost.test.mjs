import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('optional cost: publish, checkout snapshot and last published product protection',async()=>{
  const db=new PGlite();
  try {
    for(const file of ['./fixtures/store-baseline.sql','../supabase/migrations/0024_store_cart_and_pix.sql','../supabase/migrations/0025_store_catalog_admin.sql','../supabase/migrations/0027_store_dashboard.sql','../supabase/migrations/0094_store_optional_internal_cost.sql']) await db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
    const product=crypto.randomUUID(),buyer=crypto.randomUUID();
    await db.query("insert into loyalty_rewards(id,name,sku,cash_price,stock,active) values($1,'Legend teste','LEG-TEST',45,3,true)",[product]);
    await assert.rejects(db.exec("insert into loyalty_rewards(name,sku,active) values('Sem preço','NO-PRICE',true)"),/publicar/);
    await assert.rejects(db.query('update loyalty_rewards set active=false where id=$1',[product]),/último produto/);
    await db.query('insert into customers(id,email) values($1,$2)',[buyer,'optional-cost@example.invalid']);
    await db.exec('set role authenticated');
    await db.query("select set_config('test.customer',$1,false)",[buyer]);
    await db.query('select checkout_store_cart($1,$2)',[crypto.randomUUID(),JSON.stringify([{reward_id:product,quantity:1,mode:'cash',expected_cash:45,expected_coins:0}])]);
    await db.exec('reset role');
    const item=(await db.query('select unit_internal_cost,unit_cash,quantity from store_order_items where reward_id=$1',[product])).rows[0];
    assert.equal(item.unit_internal_cost,null);assert.equal(Number(item.unit_cash),45);assert.equal(item.quantity,1);
    assert.equal((await db.query('select stock from loyalty_rewards where id=$1',[product])).rows[0].stock,2);
  }finally{await db.close();}
});
