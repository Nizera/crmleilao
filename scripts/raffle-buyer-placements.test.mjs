import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { loadCommerceDb, migration } from "./fixtures/commerce-db.mjs";

test("ranking apura até três ganhadores e mantém vouchers e entregas por colocação", async () => {
  const db = new PGlite();
  try {
    await loadCommerceDb(db);
    await db.exec(`alter table lots add column discount_amount numeric not null default 0,
      add column paid_at timestamptz, add column moved_at timestamptz;
      alter table raffle_campaigns add column archived_at timestamptz,
        add column image_urls text[] not null default '{}', add column price_tiers jsonb not null default '[]';
      alter table raffle_prizes add column image_urls text[] not null default '{}';
      create table lot_freight_waivers(lot_id uuid primary key,customer_id uuid);`);
    for (const file of [
      "0050_external_prize_freight_release.sql", "0077_mixed_prize_freight.sql",
      "0080_company_prize_replacement_freight.sql", "0086_duplicate_raffle_campaign.sql",
      "0091_raffle_top_buyer.sql", "20261119194037_auction_vouchers.sql",
      "20261121222047_manual_auction_vouchers.sql", "20261122190023_mixed_buyer_bonus_physical_pix.sql",
    ]) await db.exec(await migration(file));

    const actor = crypto.randomUUID();
    const customers = Array.from({ length: 3 }, () => crypto.randomUUID());
    await db.query("insert into auth.users values($1)", [actor]);
    await db.query("insert into admin_profiles values($1,'owner')", [actor]);
    await db.query("select set_config('test.actor',$1,false),set_config('test.admin','true',false)", [actor]);
    for (const customer of customers) await db.query("insert into customers(id,name)values($1,'Cliente teste')", [customer]);
    const campaign = async () => (await db.query(`
      insert into raffle_campaigns(title,description,total_numbers,unit_price,selection_mode,draw_method,
        draw_rules,hide_winning_numbers,min_quantity,max_quantity,status,created_by)
      values('Rifa teste','Descrição de teste',20,10,'manual','external','Regulamento de teste',true,1,20,'draft',$1)
      returning id`, [actor])).rows[0].id;
    const pay = (id, customer, numbers, paidAt) => db.query(`
      insert into raffle_orders(campaign_id,customer_id,request_key,amount,numbers,status,paid_at)
      values($1,$2,gen_random_uuid(),10,$3,'paid',$4)`, [id, customer, numbers, paidAt]);
    const close = id => db.query("update raffle_campaigns set status='closed' where id=$1", [id]);

    const legacy = await campaign();
    await db.query("select set_raffle_buyer_bonus($1,'Voucher antigo','voucher',15,0)", [legacy]);
    await pay(legacy, customers[0], [1], "2026-11-28T09:00:00Z");
    await close(legacy);
    const oldVoucher = (await db.query("select id from auction_vouchers where campaign_id=$1", [legacy])).rows[0].id;

    await db.exec(await migration("20261128164000_raffle_buyer_placements.sql"));
    const old = (await db.query("select id,placement,remaining from auction_vouchers where campaign_id=$1", [legacy])).rows[0];
    assert.deepEqual(old, { id: oldVoucher, placement: 1, remaining: "15.00" });

    const id = await campaign();
    const configure = (placement, kind, amount) => db.query(
      "select set_raffle_buyer_placement($1,'Prêmio teste',$2,$3,0,$4)", [id, kind, amount, placement],
    );
    await assert.rejects(configure(3, "pix", 10), /anterior/);
    await configure(1, "voucher", 50);
    await configure(2, "voucher", 30);
    await configure(3, "physical_pix", 10);
    await pay(id, customers[0], [1, 2, 3], "2026-11-28T11:00:00Z");
    await pay(id, customers[1], [4, 5], "2026-11-28T09:00:00Z");
    await pay(id, customers[2], [6, 7], "2026-11-28T10:00:00Z");
    await close(id);
    await db.query("select finalize_raffle_buyer_bonus($1)", [id]);

    const result = (await db.query(`
      select placement,customer_id,status,prize_id from raffle_buyer_results
      where campaign_id=$1 order by placement`, [id])).rows;
    assert.deepEqual(result.map(row => row.customer_id), customers);
    assert.deepEqual(result.map(row => row.status), ["fulfilled", "fulfilled", "pending"]);
    assert.ok(result[2].prize_id);
    const vouchers = (await db.query(`
      select placement,customer_id,remaining from auction_vouchers where campaign_id=$1 order by placement`, [id])).rows;
    assert.deepEqual(vouchers, [
      { placement: 1, customer_id: customers[0], remaining: "50.00" },
      { placement: 2, customer_id: customers[1], remaining: "30.00" },
    ]);
    await db.query("select fulfill_raffle_buyer_placement($1,'Comprovante de teste',3)", [id]);
    assert.deepEqual((await db.query(`
      select pix_paid_at is not null as paid from raffle_buyer_results where campaign_id=$1 order by placement`, [id])).rows,
      [{ paid: false }, { paid: false }, { paid: true }]);

    const few = await campaign();
    await db.query("select set_raffle_buyer_placement($1,'Prêmio primeiro','pix',20,0,1), set_raffle_buyer_placement($1,'Prêmio segundo','pix',10,0,2)", [few]);
    await pay(few, customers[0], [1], "2026-11-28T09:00:00Z");
    await close(few);
    assert.equal((await db.query("select count(*)::int as total from raffle_buyer_results where campaign_id=$1", [few])).rows[0].total, 1);
  } finally {
    await db.close();
  }
});
