import { readFile } from 'node:fs/promises';
export const migration = name => readFile(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8');
export async function loadCommerceDb(db) {
  await db.exec(await readFile(new URL('./store-baseline.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('./store-current.sql', import.meta.url), 'utf8'));
  const tier = await migration('0022_loyalty_tiers_by_points.sql');
  const start = tier.indexOf('create function public.adjust_loyalty_points(');
  await db.exec(tier.slice(start, tier.indexOf('revoke all on function public.get_customer_loyalty_earned_points', start)));
  for (const f of ['0024_store_cart_and_pix.sql','0025_store_catalog_admin.sql','0026_admin_order_history.sql','0027_store_dashboard.sql','0028_loyalty_history_and_client_store.sql','0031_store_reliability_and_fulfillment.sql','0033_store_preview_only.sql','0037_store_vouchers.sql','0038_store_presentation.sql']) await db.exec(await migration(f));
  await db.exec(`create table public.charges(id uuid primary key default gen_random_uuid(),customer_id uuid,code text default 'P-FIXTURE',freight_period date,freight_amount numeric default 0,amount numeric default 0,status text default 'pending',expires_at timestamptz,paid_at timestamptz,created_at timestamptz default now());
    alter table public.lots add column auction_date date,add column charge_id uuid references public.charges(id),add column arremate_value numeric default 30,add column created_at timestamptz default now();
    alter table public.customers add column address_cep text,add column address_street text,add column address_number text,add column address_district text,add column address_city text,add column address_state text;
    create unique index charges_freight_period_uidx on charges(customer_id,freight_period) where freight_amount>0 and status in('pending','in_process','approved');
    create table public.admin_profiles(id uuid primary key,role text);
    create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
    create function public.is_owner() returns boolean language sql stable as $$select coalesce(current_setting('test.owner',true),'false')='true'$$;
    alter role service_role bypassrls;
    alter table public.shipments add column insurance_value numeric default 0;`);
  const freight = await migration('0029_mandatory_period_freight.sql');
  await db.exec(freight.slice(freight.indexOf('create table public.charge_freight_items'), freight.indexOf('create function public.get_due_freight_periods')));
  for (const f of ['0032_freight_per_accumulated_shipment.sql','0039_store_shipping_completion.sql','0035_logistics_pending.sql','0041_store_checkout_freight.sql','0042_restore_private_store_checkout.sql','0043_raffles.sql','0044_raffle_optional_shipping_date.sql','0045_store_checkout_email_guard.sql','0046_shipment_content_snapshot.sql','0047_raffle_review_resolution.sql','0048_raffle_prize_shipping.sql']) {
    const sql = await migration(f);
    if (sql.trim().length < 20) throw new Error(`Migration essencial vazia: ${f}`);
    await db.exec(sql);
  }
}
