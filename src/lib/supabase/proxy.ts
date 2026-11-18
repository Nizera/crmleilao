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
  let sessionResponse = response;
  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, cacheHeaders = {}) {
        const previousCookies = sessionResponse.cookies.getAll();
        const previousHeaders = sessionResponse.headers;
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        // NextResponse snapshots forwarded request headers. Rebuild after changing Cookie.
        sessionResponse = NextResponse.next({ request });
        previousCookies.forEach(cookie => sessionResponse.cookies.set(cookie));
        for (const key of ['cache-control','expires','pragma']) {
          const value=previousHeaders.get(key);if(value)sessionResponse.headers.set(key,value);
        }
        cookiesToSet.forEach(({ name, value, options }) =>
          sessionResponse.cookies.set(name, value, options)
        );
        sessionResponse.headers.set('Cache-Control','private, no-store');
        Object.entries(cacheHeaders).forEach(([key,value])=>sessionResponse.headers.set(key,value));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();

  return { response: sessionResponse, user };
}
