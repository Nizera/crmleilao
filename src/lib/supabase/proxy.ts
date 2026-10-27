import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Refresca la sessão de Supabase no proxy (Next 16: substituto do middleware).
 * Retorna a resposta com os cookies atualizados.
 *
 * Valida a sessão no Auth. A autorização de perfil continua no DAL e no RLS.
 */
export async function refreshSession(
  request: NextRequest,
  response: NextResponse
) {
  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();

  return { response, user };
}
