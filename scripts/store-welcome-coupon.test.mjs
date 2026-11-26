import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { loadCommerceDb, migration } from './fixtures/commerce-db.mjs';

test('BEMVINDO10 validates the first order, preserves freight and can be reused after cancellation', async () => {
  const db = new PGlite();
  try {
    await loadCommerceDb(db);
    await db.exec(await migration('0061_store_cancellation_and_auction_payments.sql'));
    await db.exec(await migration('20261126071000_store_welcome_coupon.sql'));
    await db.exec('update store_commerce_settings set purchases_enabled=true');
    const id = crypto.randomUUID();
    const product = crypto.randomUUID();
    await db.query("insert into customers(id,name,email,phone_e164,cpf_cnpj,address_cep,address_street,address_number,address_district,address_city,address_state) values($1,'Cliente','teste@example.invalid','+5500000000000','11111111111','18110000','Rua','1','Centro','Cidade','SP')", [id]);
    await db.query("insert into loyalty_rewards(id,name,internal_cost,cash_price,stock,active,delivery_kind) values($1,'Produto',1,80,10,true,'physical')", [product]);
    const asCustomer = async () => {
      await db.exec('set role authenticated');
      await db.query("select set_config('test.customer',$1,false)", [id]);
    };
    const checkout = async (key, quantity, discount, freight = 20) => {
      const items = [{ reward_id:product, quantity, mode:'cash', expected_cash:80, expected_coins:0, expected_freight_amount:freight }];
      const { rows } = await db.query("select checkout_store_cart_with_coupon($1,$2,'bemvindo10',$3) id", [key,JSON.stringify(items),discount]);
      return rows[0].id;
    };
    await asCustomer();
    await assert.rejects(checkout(crypto.randomUUID(),2,15),/desconto atualizado/);
    const key = crypto.randomUUID();
    const order = await checkout(key,1,8);
    assert.equal(await checkout(key,1,8),order);
    const { rows: [saved] } = await db.query('select cash_total, freight_amount, coupon_code from store_orders where id=$1',[order]);
    assert.equal(Number(saved.cash_total),92);
    assert.equal(Number(saved.freight_amount),20);
    assert.equal(saved.coupon_code,'BEMVINDO10');
    await db.exec('reset role');
    await db.query('select request_store_order_cancellation($1,$2)',[order,id]);
    await asCustomer();
    const next = await checkout(crypto.randomUUID(),2,16);
    await db.exec('reset role');
    await db.query("select settle_store_payment(external_reference,'ORD_TEST',cash_total,'paid',null) from store_orders where id=$1",[next]);
    await asCustomer();
    await assert.rejects(checkout(crypto.randomUUID(),2,16,0),/primeira compra/);
  } finally {
    await db.close();
  }
});
