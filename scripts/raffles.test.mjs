import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Rifas: reservas, isolamento, pagamentos e entrega de prêmios', async t => {
  const db = new PGlite();
  const admin = crypto.randomUUID(), viewer = crypto.randomUUID(), a = crypto.randomUUID(), b = crypto.randomUUID();
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const owner = () => db.exec('reset role');
  const as = async (id, role = 'authenticated') => { await owner(); await db.query("select set_config('test.uid',$1,false)", [id]); await db.exec(`set role ${role}`); };
  const reserve = (c, numbers, key = crypto.randomUUID()) => scalar('select reserve_raffle($1,$2,$3::int[],null)', [c, key, numbers]);
  const manage = (c, action, title = null, qty = 1) => db.query('select manage_raffle($1,$2,$3,$4)', [c, action, title, qty]);
  const settle = async (o, state, amount) => {
    await owner(); const row = (await db.query('select external_reference,amount from raffle_orders where id=$1', [o])).rows[0];
    await as('', 'service_role');
    await db.query('select settle_raffle_payment($1,$2,$3,$4)', [row.external_reference, 'ORD_' + o, amount ?? row.amount, state]);
  };
  let c, prizeNumber, instantOrder;
  try {
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
    const draft = { title: 'Campanha teste', description: 'Regulamento da campanha teste.', total_numbers: 10, unit_price: 19.99, selection_mode: 'both', draw_method: 'external', draw_rules: 'Resultado externo com regra definida.', shipping_date: '2026-11-10', image_url: '', hide_winning_numbers: true, min_quantity: 1, max_quantity: 5 };
    await t.test('cliente e viewer não criam campanha nem liberam vendas', async () => {
      await as(a); await assert.rejects(scalar('select save_raffle_campaign($1::jsonb)', [JSON.stringify(draft)]), /Acesso negado/);
      await as(viewer); await assert.rejects(scalar('select save_raffle_campaign($1::jsonb)', [JSON.stringify(draft)]), /Acesso negado/);
      await as(a); await assert.rejects(db.query('select set_raffle_purchases(true)'), /Acesso negado|permission denied/);
    });
    await t.test('rascunho invisível ao cliente e publicação exige prêmio', async () => {
      await as(admin); c = await scalar('select save_raffle_campaign($1::jsonb)', [JSON.stringify(draft)]);
      await assert.rejects(manage(c, 'open'), /prêmio principal/);
      await as(a); assert.equal(await scalar('select count(*)::int from raffle_campaigns'), 0);
      await assert.rejects(db.query('select get_raffle_detail($1,0)', [c]), /não encontrada/);
      await as(admin); await manage(c, 'main', 'Quadro principal'); await manage(c, 'instant', 'Figurinha premiada', 2); await manage(c, 'open');
      await owner(); prizeNumber = await scalar("select number from raffle_prizes where kind='instant' order by number limit 1");
    });
    await t.test('chave global bloqueia chamada direta ao banco', async () => {
      await as(a); await assert.rejects(reserve(c, [0]), /não foram liberadas/);
      await as(admin); await db.exec('select set_raffle_purchases(true)');
    });
    await t.test('cotas ocultas e dados de outros clientes não vazam', async () => {
      await as(a); const detail = await scalar('select get_raffle_detail($1,0)', [c]);
      assert.equal(detail.numbers[0].number, 0); assert.equal(detail.numbers.length, 10);
      assert.ok(detail.prizes.every(p => p.number === null));
      assert.equal(await scalar('select count(*)::int from raffle_prizes'), 0);
      await assert.rejects(db.query('select * from raffle_allocations'), /permission denied/);
      await assert.rejects(db.query('select get_raffle_admin_stats($1)', [c]), /Acesso negado/);
      await assert.rejects(db.query("select materialize_raffle_award(gen_random_uuid(),gen_random_uuid(),0,null,null)"), /permission denied/);
    });
    await t.test('números inválidos, repetidos e quantidade excessiva não geram pedidos', async () => {
      await as(a);
      await assert.rejects(reserve(c, [0, 0]), /repetidas/);
      await assert.rejects(reserve(c, [10]), /intervalo/);
      await assert.rejects(reserve(c, [-1]), /intervalo/);
      await assert.rejects(reserve(c, [null]), /inválidas|intervalo/);
      await assert.rejects(reserve(c, [0, 1, 2, 3, 4, 5]), /limites/);
      assert.equal(await scalar('select count(*)::int from raffle_orders'), 0);
    });
    await t.test('reserva é idempotente e não permite duas pessoas na mesma cota', async () => {
      await as(a); const key = crypto.randomUUID(); instantOrder = await reserve(c, [prizeNumber], key);
      assert.equal(await reserve(c, [prizeNumber], key), instantOrder);
      assert.equal(await scalar('select amount::text from raffle_orders where id=$1', [instantOrder]), '19.99');
      await assert.rejects(reserve(c, [(prizeNumber + 1) % 10]), /reserva aberta/);
      await as(b); assert.equal(await scalar('select count(*)::int from raffle_orders'), 0);
      await assert.rejects(reserve(c, [prizeNumber]), /acabaram de ser reservadas/);
      assert.deepEqual(await scalar('select get_raffle_awards(1)'), []);
    });
    await t.test('pagamento divergente é recusado; confirmação repetida gera um prêmio e uma logística', async () => {
      await assert.rejects(settle(instantOrder, 'paid', 1), /divergente/);
      await as(a); await assert.rejects(db.query("select settle_raffle_payment('x','x',1,'paid')"), /permission denied/);
      await settle(instantOrder, 'paid'); await settle(instantOrder, 'paid');
      await as(a); const awards = await scalar('select get_raffle_awards(1)');
      assert.equal(awards.length, 1); assert.equal(awards[0].number, prizeNumber); assert.equal(awards[0].order_id, instantOrder);
      await as(b); assert.deepEqual(await scalar('select get_raffle_awards(1)'), []);
      await owner(); assert.equal(await scalar("select count(*)::int from logistics_pending where source_kind='raffle'"), 1);
      assert.match(await scalar('select reason from logistics_pending'), /^Rifa: Campanha teste · Cota \d{3}$/);
    });
    let auto, autoNumbers;
    await t.test('seleção automática atribui números livres sem repetição', async () => {
      await as(b); auto = await scalar('select reserve_raffle($1,$2,null,3)', [c, crypto.randomUUID()]);
      autoNumbers = await scalar('select numbers from raffle_orders where id=$1', [auto]);
      assert.equal(autoNumbers.length, 3); assert.equal(new Set(autoNumbers).size, 3); assert.ok(!autoNumbers.includes(prizeNumber));
    });
    await t.test('relógio local não libera cotas; cancelamento confirmado libera e pagamento tardio vai para análise', async () => {
      await owner(); await db.query("update raffle_orders set expires_at=now()-interval '1 day' where id=$1", [auto]);
      assert.equal(await scalar('select count(*)::int from raffle_allocations where order_id=$1', [auto]), 3);
      await settle(auto, 'cancelled'); await owner();
      assert.equal(await scalar('select count(*)::int from raffle_allocations where order_id=$1', [auto]), 0);
      await settle(auto, 'paid'); await owner(); assert.equal(await scalar('select status from raffle_orders where id=$1', [auto]), 'review');
    });
    await t.test('adicionar cotas premiadas usa apenas números livres e exige campanha pausada', async () => {
      await as(admin); await assert.rejects(manage(c, 'instant', 'Extra', 1), /Pause/);
      await manage(c, 'pause'); await manage(c, 'instant', 'Extra', 1);
      await owner(); assert.equal(await scalar('select count(*)::int from raffle_prizes p join raffle_allocations a on a.campaign_id=p.campaign_id and a.number=p.number where p.title=$1', ['Extra']), 0);
    });
    await t.test('resultado exige cota paga e reservas resolvidas; link é opcional e ganhador não é sobrescrito', async () => {
      // A campanha anterior tem análise pendente: usa uma nova para verificar apuração completa.
      await as(admin); const next = await scalar('select save_raffle_campaign($1::jsonb)', [JSON.stringify(draft)]);
      await manage(next, 'main', 'Prêmio final'); await manage(next, 'open');
      await as(a); const o = await reserve(next, [0]); await settle(o, 'paid');
      await as(admin); const p = await scalar("select id from raffle_prizes where campaign_id=$1 and kind='main'", [next]);
      await assert.rejects(db.query('select record_raffle_winner($1,0,$2,$3)', [p, 'Resultado comprovado', 'https://example.invalid/resultado']), /Pause/);
      await manage(next, 'pause');
      await assert.rejects(db.query('select record_raffle_winner($1,1,$2,$3)', [p, 'Resultado comprovado', 'https://example.invalid/resultado']), /pagamento confirmado/);
      await assert.rejects(db.query('select record_raffle_winner($1,0,$2,$3)', [p, 'Resultado comprovado', 'http://inseguro.invalid']), /HTTPS/);
      await db.query('select record_raffle_winner($1,0,$2,$3)', [p, 'Resultado comprovado', null]);
      await owner(); assert.equal(await scalar('select evidence_url from raffle_awards where prize_id=$1', [p]), null); await as(admin);
      await assert.rejects(db.query('select record_raffle_winner($1,0,$2,$3)', [p, 'Resultado comprovado', 'https://example.invalid/resultado']), /Pause|já registrado/);
      assert.equal(await scalar('select status from raffle_campaigns where id=$1', [next]), 'closed');
      await as(a);
      const mainAwards = await scalar('select get_raffle_awards(1)');
      const main = mainAwards.find(award => award.order_id === o && award.kind === 'main');
      assert.ok(main, 'O prêmio principal aparece em Meus prêmios do dono da cota');
      assert.equal(main.customer_id, a);
      await owner();
      assert.equal(await scalar('select customer_id from logistics_pending where id=$1', [main.logistics_id]), a);
      assert.equal(await scalar('select count(*)::int from raffle_awards where prize_id=$1', [p]), 1);
      await as(b); assert.deepEqual(await scalar('select get_raffle_awards(1,$1::uuid[])', [[o]]), []);
      await as(admin);
      await manage(next, 'close');
      const result = await scalar('select list_raffle_admin_orders($1,null,$2,1)', [next, '000']);
      assert.equal(result.total, 1); assert.equal(result.items[0].has_award, true);
    });
    await t.test('só cotas pagas pausam automaticamente; reserva não basta e prêmio continua vinculado', async () => {
      await as(admin); const next = await scalar('select save_raffle_campaign($1::jsonb)', [JSON.stringify({ ...draft, total_numbers: 2, max_quantity: 2 })]);
      await manage(next, 'main', 'Principal'); await manage(next, 'instant', 'Surpresa', 1); await manage(next, 'open');
      await as(a); const first = await reserve(next, [0]);
      await as(b); const second = await reserve(next, [1]);
      await owner(); assert.equal(await scalar('select status from raffle_campaigns where id=$1', [next]), 'open');
      await settle(first, 'paid'); await owner();
      assert.equal(await scalar('select status from raffle_campaigns where id=$1', [next]), 'open');
      await settle(second, 'paid'); await owner();
      assert.equal(await scalar('select status from raffle_campaigns where id=$1', [next]), 'paused');
      assert.equal(await scalar('select count(*)::int from raffle_awards where campaign_id=$1', [next]), 1);
      await settle(second, 'paid'); await owner();
      assert.equal(await scalar("select count(*)::int from raffle_events where campaign_id=$1 and action='Todas as cotas pagas: vendas pausadas para apuração'", [next]), 1);
      await as(admin); await assert.rejects(manage(next, 'open'), /Todas as cotas/);
      const prize = await scalar("select id from raffle_prizes where campaign_id=$1 and kind='main'", [next]);
      await db.query('select record_raffle_winner($1,0,$2,null)', [prize, 'Resultado comprovado']);
      assert.equal(await scalar('select status from raffle_campaigns where id=$1', [next]), 'closed');
    });
    await t.test('vários prêmios principais mantêm a pausa até o último ganhador', async () => {
      await as(admin); const next = await scalar('select save_raffle_campaign($1::jsonb)', [JSON.stringify(draft)]);
      await manage(next, 'main', 'Prêmio principal', 2); await manage(next, 'open');
      await as(a); const order = await reserve(next, [0, 1]); await settle(order, 'paid');
      await as(admin); await manage(next, 'pause');
      const prizes = (await db.query("select id from raffle_prizes where campaign_id=$1 and kind='main' order by id", [next])).rows;
      await db.query('select record_raffle_winner($1,0,$2,$3)', [prizes[0].id, 'Resultado comprovado', 'https://example.invalid/resultado']);
      assert.equal(await scalar('select status from raffle_campaigns where id=$1', [next]), 'paused');
      await db.query('select record_raffle_winner($1,1,$2,$3)', [prizes[1].id, 'Resultado comprovado', 'https://example.invalid/resultado']);
      assert.equal(await scalar('select status from raffle_campaigns where id=$1', [next]), 'closed');
      await as(a); const awards = await scalar('select get_raffle_awards(1,$1::uuid[])', [[order]]);
      assert.equal(awards.length, 2); assert.ok(awards.every(award => award.customer_id === a));
    });
    await t.test('galeria exige equipe com escrita, limita fotos e mantém capa e auditoria', async () => {
      await as(admin); const campaign = await scalar('select save_raffle_campaign($1::jsonb)', [JSON.stringify(draft)]);
      const photos = ['https://example.invalid/capa.webp', 'https://example.invalid/detalhe.webp'];
      await as(a); await assert.rejects(db.query('select set_raffle_photos($1,$2::text[])', [campaign, photos]), /Acesso negado/);
      await as(viewer); await assert.rejects(db.query('select set_raffle_photos($1,$2::text[])', [campaign, photos]), /Acesso negado/);
      await as(admin);
      for (const invalid of [Array(7).fill(photos[0]), ['javascript:alert(1)'], [null], null]) {
        await assert.rejects(db.query('select set_raffle_photos($1,$2::text[])', [campaign, invalid]), /seis imagens/);
      }
      await db.query('select set_raffle_photos($1,$2::text[])', [campaign, photos]);
      assert.equal(await scalar('select image_url from raffle_campaigns where id=$1', [campaign]), photos[0]);
      assert.deepEqual(await scalar('select image_urls from raffle_campaigns where id=$1', [campaign]), photos);
      assert.equal(await scalar("select actor from raffle_events where campaign_id=$1 and action='Fotos da campanha atualizadas'", [campaign]), admin);
      await db.query('select set_raffle_photos($1,$2::text[])', [campaign, []]);
      assert.equal(await scalar('select image_url from raffle_campaigns where id=$1', [campaign]), '');
      await as('', 'anon'); await assert.rejects(db.query('select set_raffle_photos($1,$2::text[])', [campaign, photos]), /permission denied/);
    });
    await t.test('estorno não redistribui cota e bloqueia prêmio ainda não enviado', async () => {
      await settle(instantOrder, 'review'); await owner();
      assert.equal(await scalar('select status from raffle_orders where id=$1', [instantOrder]), 'review');
      assert.equal(await scalar('select count(*)::int from raffle_allocations where order_id=$1', [instantOrder]), 1);
      assert.equal(await scalar('select cancelled_at is not null from logistics_pending l join raffle_awards a on a.logistics_id=l.id where a.order_id=$1', [instantOrder]), true);
    });
    await t.test('reconciliação é privada e não reclama o mesmo pedido imediatamente', async () => {
      await as(a); await assert.rejects(db.query('select claim_raffle_reconciliation()'), /permission denied/);
      await as(admin); const fresh = await scalar('select save_raffle_campaign($1::jsonb)', [JSON.stringify(draft)]);
      await manage(fresh, 'main', 'Prêmio reconciliação'); await manage(fresh, 'open');
      await as(b); const pending = await reserve(fresh, [0]);
      await as('', 'service_role'); const first = (await db.query('select id from claim_raffle_reconciliation()')).rows;
      const second = (await db.query('select id from claim_raffle_reconciliation()')).rows;
      assert.ok(first.some(x => x.id === pending));
      assert.ok(first.every(x => !second.some(y => y.id === x.id)));
    });
    await t.test('prêmios do pedido não somem quando ultrapassam a primeira página e filtro mantém isolamento', async () => {
      await as(admin); const next = await scalar('select save_raffle_campaign($1::jsonb)', [JSON.stringify({ ...draft, total_numbers: 50, max_quantity: 50 })]);
      await manage(next, 'main', 'Principal'); await manage(next, 'instant', 'Prêmio múltiplo', 25); await manage(next, 'open');
      await owner(); const ns = (await db.query("select number from raffle_prizes where campaign_id=$1 and kind='instant'", [next])).rows.map(r => r.number);
      await as(a); const order = await reserve(next, ns); await settle(order, 'paid');
      await as(a); const first = await scalar('select get_raffle_awards(1)'); const second = await scalar('select get_raffle_awards(2)');
      assert.equal(first.length, 20); assert.ok(second.length >= 5);
      const own = await scalar('select get_raffle_awards(1,$1::uuid[])', [[order]]); assert.equal(own.length, 25);
      await as(b); assert.deepEqual(await scalar('select get_raffle_awards(1,$1::uuid[])', [[order]]), []);
      await as('', 'anon'); await assert.rejects(reserve(next, [49]), /permission denied/);
    });
  } finally { await db.close(); }
});
