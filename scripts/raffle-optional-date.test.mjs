import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64');

test('Previsão opcional aceita vazio/ausência e recusa datas impossíveis', async () => {
  const dates = moduleUrl(await read('../src/lib/dates.ts'));
  const source = (await read('../src/lib/raffles.ts'))
    .replace('import { z } from "zod";', `import { z } from ${JSON.stringify(import.meta.resolve('zod'))};`)
    .replace('import { isIsoDay } from "@/lib/dates";', `import { isIsoDay } from ${JSON.stringify(dates)};`);
  const { raffleSchema } = await import(moduleUrl(source));
  const input = { title: 'Campanha teste', description: 'Regulamento completo', total_numbers: 100, unit_price: 10, selection_mode: 'both', draw_method: 'external', draw_rules: 'Resultado externo registrado', image_url: '', hide_winning_numbers: true, min_quantity: 1, max_quantity: 100 };
  for (const date of [undefined, null, '']) assert.equal(raffleSchema.parse({ ...input, shipping_date: date }).shipping_date, null);
  assert.equal(raffleSchema.parse({ ...input, shipping_date: '2026-11-10' }).shipping_date, '2026-11-10');
  for (const date of ['2026-02-30', 'texto', '2026-13-01']) assert.equal(raffleSchema.safeParse({ ...input, shipping_date: date }).success, false);
});

test('Migration 0044 preserva previsão e permite premiação sem data, sem duplicar logística', async () => {
  const db = new PGlite();
  const scalar = async sql => Object.values((await db.query(sql)).rows[0])[0];
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table raffle_campaigns(id uuid primary key, title text,total_numbers int,shipping_date date not null,created_by uuid);
      create table raffle_prizes(id uuid primary key,campaign_id uuid,title text);
      create table raffle_orders(id uuid primary key,campaign_id uuid,customer_id uuid,status text,numbers int[]);
      create table logistics_pending(id uuid primary key default gen_random_uuid(),customer_id uuid,title text,quantity int,reason text,shipping_date date not null,created_by uuid,source_kind text);
      create table raffle_awards(id uuid primary key default gen_random_uuid(),prize_id uuid unique,campaign_id uuid,order_id uuid,customer_id uuid,number int,logistics_id uuid,result_note text,evidence_url text);
    `);
    await db.exec(await read('../supabase/migrations/0044_raffle_optional_shipping_date.sql'));
    await db.exec(`
      insert into raffle_campaigns values('11111111-1111-4111-8111-111111111111','Sem previsão',100,null,null),('22222222-2222-4222-8222-222222222222','Com previsão',100,'2026-12-15',null);
      insert into raffle_prizes select id,id,'Prêmio' from raffle_campaigns;
      insert into raffle_orders select id,id,gen_random_uuid(),'paid',array[0] from raffle_campaigns;
      select materialize_raffle_award(id,id,0) from raffle_campaigns;
      select materialize_raffle_award(id,id,0) from raffle_campaigns;
    `);
    assert.equal(await scalar('select count(*)::int from logistics_pending'), 2);
    assert.equal(await scalar("select l.shipping_date=(now() at time zone 'America/Sao_Paulo')::date from logistics_pending l join raffle_awards a on a.logistics_id=l.id join raffle_campaigns c on c.id=a.campaign_id where c.title='Sem previsão'"), true);
    assert.equal(await scalar("select shipping_date is null from raffle_campaigns where title='Sem previsão'"), true);
    assert.equal(await scalar("select l.shipping_date=date '2026-12-15' from logistics_pending l join raffle_awards a on a.logistics_id=l.id join raffle_campaigns c on c.id=a.campaign_id where c.title='Com previsão'"), true);
    await db.exec('set role authenticated');
    await assert.rejects(db.query("select materialize_raffle_award('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111',0)"), /permission denied/);
  } finally { await db.close(); }
});
