import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseSecretKey, supabaseUrl } from "./env";

/**
 * Cliente com a service role key: IGNORA RLS.
 *
 * Só pode ser usado em servidor (route handlers de webhook, jobs internos).
 * Nunca importar em componentes de cliente.
 */
export function createAdminClient() {
  return createSupabaseClient(supabaseUrl(), supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
