import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { supabasePublishableKey, supabaseUrl } from "./env";

export async function createClient() {
  // O SDK inicializa timers de sessão: só deve começar na requisição real,
  // inclusive quando o Next tenta pré-renderizar uma rota autenticada.
  await connection();
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Chamado a partir de um Server Component: ignorar, o
          // proxy.ts cuida do refresh do token na navegação.
        }
      },
    },
  });
}
