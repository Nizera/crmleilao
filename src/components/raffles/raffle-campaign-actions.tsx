"use client";
import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, Copy, ExternalLink, MoreHorizontal, RotateCcw, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { duplicateRaffle, raffleCampaignLifecycle } from "@/app/actions/raffles";
import type { Raffle } from "@/lib/raffles";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

export function RaffleCampaignActions({ campaign, owner }: { campaign: Raffle; owner: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const request = useRef<string | null>(null);
  function duplicate() {
    if (!window.confirm("Duplicar como rascunho? Serão copiados dados, fotos, promoções e prêmios do sorteio. Cotas premiadas, reservas, pagamentos e ganhadores não serão copiados. A data de envio ficará em branco para revisão.")) return;
    request.current ??= crypto.randomUUID();
    start(async () => {
      const result = await duplicateRaffle(campaign.id, request.current!);
      if (!result.ok) { toast.error(result.error); return; }
      toast.success("Rascunho duplicado. Revise os dados e cadastre as cotas premiadas antes de publicar.");
      router.push(`/admin/rifa/${result.data}`); router.refresh();
    });
  }
  function lifecycle(action: "archive" | "restore" | "delete") {
    const question = action === "archive" ? "Arquivar esta campanha? Novas vendas serão interrompidas; o histórico será preservado." : action === "restore" ? "Restaurar esta campanha? As vendas não serão reabertas automaticamente." : "Excluir definitivamente este rascunho? Campanhas com reservas não podem ser excluídas.";
    if (!window.confirm(question)) return;
    start(async () => {
      const result = await raffleCampaignLifecycle(campaign.id, action);
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(action === "delete" ? "Rascunho excluído." : action === "archive" ? "Campanha arquivada." : "Campanha restaurada.");
      router.refresh();
    });
  }
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" disabled={pending} aria-label={`Mais ações de ${campaign.title}`}><MoreHorizontal size={16} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-60"><DropdownMenuGroup><DropdownMenuLabel>Ações da campanha</DropdownMenuLabel><DropdownMenuItem asChild><Link href={`/admin/rifa/${campaign.id}`}><ExternalLink />Gerenciar campanha</Link></DropdownMenuItem><DropdownMenuItem asChild><Link href={`/admin/rifa/reservas?campaign=${campaign.id}`}><Users />Ver reservas</Link></DropdownMenuItem>{campaign.status === "closed" && <DropdownMenuItem onSelect={duplicate}><Copy />Duplicar como rascunho</DropdownMenuItem>}<DropdownMenuSeparator /><DropdownMenuItem onSelect={() => lifecycle(campaign.archived_at ? "restore" : "archive")}>{campaign.archived_at ? <RotateCcw /> : <Archive />}{campaign.archived_at ? "Restaurar campanha" : "Arquivar campanha"}</DropdownMenuItem>{owner && campaign.status === "draft" && <DropdownMenuItem variant="destructive" onSelect={() => lifecycle("delete")}><Trash2 />Excluir rascunho</DropdownMenuItem>}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>;
}
