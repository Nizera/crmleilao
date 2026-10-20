import { Gavel } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

/** Placeholder: ainda não há modelo de leilão ao vivo — só o visual do redesign. */
export default async function ClientLivePage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amarelo opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-amarelo" />
        </span>
        <h1 className="text-base font-bold tracking-tight">Ao Vivo</h1>
      </div>
      <EmptyState
        icon={Gavel}
        title="Nenhum leilão ao vivo agora"
        description="Quando o Mega Drop começar, os lotes em disputa aparecem aqui em tempo real. Fique de olho no grupo!"
      />
    </div>
  );
}
