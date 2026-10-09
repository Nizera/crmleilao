import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ShieldAlert } from "lucide-react";

import { EndSessionButton } from "@/components/end-session-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAuthUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Sem acesso" };

// Lê cookies() na request: não entra no prerender.
export const instant = false;

/**
 * Destino dos guards quando a sessão não tem vínculo com a área pedida.
 * Evita o loop /admin → /login → /admin para usuário autenticado sem perfil.
 */
export default async function SemAcessoPage({
  searchParams,
}: PageProps<"/sem-acesso">) {
  const user = await getAuthUser();
  if (!user) redirect("/");

  const { motivo } = await searchParams;
  const supabase = await createClient();

  const [{ data: adminProfile }, { data: customer }] = await Promise.all([
    supabase
      .from("admin_profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("customers")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
  ]);

  const fromClientArea = motivo === "cliente";

  const title = fromClientArea
    ? "Esta área é para clientes"
    : "Você não tem acesso à equipe";
  const description = fromClientArea
    ? adminProfile
      ? "Você faz parte da equipe — o painel do cliente é para os participantes do leilão."
      : "Seu número ainda não está vinculado a um cliente. Peça ao admin para cadastrar seu WhatsApp ao lançar um lote."
    : customer
      ? "Sua conta dá acesso ao painel do cliente, não ao painel interno da equipe."
      : "Peça ao dono para adicionar seu e-mail à equipe e rode o add_admin no SQL Editor.";

  const altLink = fromClientArea
    ? adminProfile
      ? { href: "/admin", label: "Ir para o painel da equipe" }
      : null
    : customer
      ? { href: "/painel", label: "Ir para meu painel" }
      : null;

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-md border bg-muted">
            <ShieldAlert className="size-5 text-muted-foreground" />
          </div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {altLink && (
            <Button asChild>
              <Link href={altLink.href}>
                {altLink.label}
                <ArrowRight />
              </Link>
            </Button>
          )}
          <div className="flex items-center justify-between gap-3">
            <Badge variant="outline">
              {fromClientArea ? "Área do cliente" : "Área da equipe"}
            </Badge>
            <EndSessionButton />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
