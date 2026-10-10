import Link from "next/link";
import { MessageCircle, Trophy } from "lucide-react";
import { ClientLoginForm } from "@/components/client/client-login-form";

export const metadata = { title: "Entrar no seu painel" };

export default function ClientLoginPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Trophy className="size-4" />
          </span>
          Caras das Legends
        </Link>
        <ClientLoginForm className="w-full" />
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MessageCircle className="size-3.5" />
          Acesso com seu WhatsApp e senha de convite
        </p>
      </div>
    </div>
  );
}
