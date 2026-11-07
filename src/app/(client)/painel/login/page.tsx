import { connection } from "next/server";
import { safeCommerceNext } from "@/lib/commerce-access";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ClientLoginForm } from "@/components/client/client-login-form";

export const metadata = { title: "Entrar no seu painel" };
export const instant = false;

export default async function ClientLoginPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  await connection();
  const next = safeCommerceNext((await searchParams).next);
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <Link href="/">
          <Logo className="w-64" />
        </Link>
        <ClientLoginForm className="w-full" next={next} />
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MessageCircle className="size-3.5" />
          Entre com seu e-mail ou WhatsApp e sua senha
        </p>
      </div>
    </div>
  );
}
