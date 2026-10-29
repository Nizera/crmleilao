// Somente leitura: GET com limit=0 verifica o schema sem retornar registros.
// Não usar HEAD: o gateway pode responder 204 mesmo para uma tabela ausente.
import { createClient } from '@supabase/supabase-js';
process.loadEnvFile('.env.local');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let failed = false;
for (const [table, columns] of [
  ['logistics_pending', 'id,customers(id),shipment:shipments(id,batch_date)'],
  ['logistics_pending_list', 'id,state'],
]) {
  const { error } = await db.from(table).select(columns).limit(0);
  console.log(JSON.stringify({ table, ready: !error, code: error?.code ?? null }));
  failed ||= Boolean(error);
}
if (failed) {
  console.error('Confira a migration 0035_logistics_pending.sql antes de liberar o fluxo de reposições.');
  process.exitCode = 1;
}
