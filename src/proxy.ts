import { safeCommerceNext } from "@/lib/commerce-access";
import { type NextRequest, NextResponse } from "next/server";
import { refreshSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const response = NextResponse.next({ request });
  const { user } = await refreshSession(request, response);

  const authenticated = !!user;
  const redirectWithCookies = (url: URL) => {
    const redirected = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) {
      redirected.cookies.set(cookie);
    }
    return redirected;
  };

  const isAdminArea = pathname.startsWith("/admin");
  const isClientArea = pathname.startsWith("/painel");

  // Telas públicas da área do cliente (login e aceite de convite).
  const publicClientPaths = new Set(["/painel/login", "/painel/convite", "/painel/acesso-email", "/painel/ativar"]);

  // Sem sessão: manda para a tela de login da área certa.
  if (isAdminArea && !authenticated) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return redirectWithCookies(url);
  }

  if (isClientArea && !publicClientPaths.has(pathname) && !authenticated) {
    const tab=request.nextUrl.searchParams.get("tab");
    if ((pathname==="/painel/loja" && (!tab||tab==="products")) || (pathname==="/painel/rifas" && !tab) || /^\/painel\/rifas\/[^/]+$/.test(pathname)) {
      const publicUrl=request.nextUrl.clone();publicUrl.pathname=pathname.replace("/painel","");return redirectWithCookies(publicUrl);
    }
    const url = request.nextUrl.clone();
    url.pathname = "/painel/login";
    url.search = "";
    url.searchParams.set("next",safeCommerceNext(pathname+request.nextUrl.search));
    return redirectWithCookies(url);
  }

  // Com sessão: não volta para as telas de login.
  if (
    (pathname === "/login" || pathname === "/painel/login" || pathname === "/painel/convite") &&
    authenticated
  ) {
    const url = request.nextUrl.clone();
    const target=pathname==="/login"?"/admin":safeCommerceNext(request.nextUrl.searchParams.get("next"));
    const destination=new URL(target,request.url);url.pathname=destination.pathname;url.search=destination.search;
    return redirectWithCookies(url);
  }

  return response;
}

export const config = {
  // Exclui API (webhooks validam a própria assinatura) e assets estáticos.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
