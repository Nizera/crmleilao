import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { InviteAcceptForm } from "@/components/client/invite-accept-form";
import { formatPhoneBR } from "@/lib/customers";
import { getInvitePreview } from "@/lib/dal";

export const metadata = { title: "Convite para o painel" };

// Token por request: a rota é dinâmica (bloqueada), não pré-renderizada.
export const instant = false;

const INVALID_COPY = {
  invalid: {
    title: "Link inválido",
    text: "Confira se o link chegou completo, ou peça um novo link de convite ao admin.",
  },
  used: {
    title: "Convite já usado",
    text: "Este link já foi utilizado. Entre com celular e senha, ou peça um novo link ao admin.",
  },
  expired: {
    title: "Link expirado",
    text: "Os convites valem por 7 dias. Peça um novo link de convite ao admin.",
  },
} as const;

export default async function ConvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";
  const preview = token ? await getInvitePreview(token) : null;

  if (!preview || preview.state !== "ok") {
    const copy = INVALID_COPY[preview?.state ?? "invalid"];
    return (
      <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
        <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
          <Link href="/">
            <Logo tileClassName="size-8" />
          </Link>
          <div className="rounded-lg border bg-card p-6">
            <h1 className="text-lg font-semibold">{copy.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{copy.text}</p>
          </div>
          <Link
            href="/painel/login"
            className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Ir para a tela de entrada
          </Link>
        </div>
      </div>
    );
  }

  const firstName = preview.name?.trim().split(" ")[0] ?? "";

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <Link href="/">
          <Logo tileClassName="size-8" />
        </Link>
        <InviteAcceptForm
          token={token}
          name={firstName}
          phone={formatPhoneBR(preview.phone_e164)}
        />
      </div>
    </div>
  );
}
