"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  MessageCircle,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { deleteCustomer } from "@/app/actions/customers";
import { createCustomerInvite } from "@/app/actions/invites";
import { CustomerFormSheet } from "@/components/admin/customers/customer-form";
import { LotStatusBadge } from "@/components/admin/lots/lot-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateBR } from "@/components/ui/date-br";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  CustomerDetail,
  CustomerLotStats,
  CustomerNextShipment,
  CustomerSpendingSummary,
  InviteStatus,
} from "@/lib/dal";
import { formatPhoneBR } from "@/lib/customers";
import { SHIPMENT_STATUS_LABELS } from "@/lib/shipments";
import {
  formatBRL,
  formatDateBR,
  waMessageLink,
  type Lot,
} from "@/lib/lots";

type Props = {
  customer: CustomerDetail;
  lots: Lot[];
  total: number;
  page: number;
  pageSize: number;
  stats: CustomerLotStats;
  invite: InviteStatus;
  spending: CustomerSpendingSummary;
  nextShipment: CustomerNextShipment | null;
};

export function CustomerDetailView({
  customer,
  lots,
  total,
  page,
  pageSize,
  stats,
  invite,
  spending,
  nextShipment,
}: Props) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [invitePending, startInviteTransition] = useTransition();

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const remove = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    startTransition(async () => {
      const result = await deleteCustomer(customer.id);
      if (!result.ok) {
        setArmed(false);
        toast.error(result.error);
        return;
      }
      toast.success("Cliente excluído.");
      router.push("/admin/clientes");
      router.refresh();
    });
  };

  const generateInvite = () => {
    startInviteTransition(async () => {
      const result = await createCustomerInvite(customer.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      try {
        await navigator.clipboard.writeText(result.data.url);
      } catch {
        // Sem cópia automática: o link também vai no WhatsApp.
      }
      const firstName = customer.name?.trim().split(" ")[0] ?? "aqui";
      toast.success("Convite gerado e link copiado!", {
        description: "Vale 7 dias e pode ser usado uma única vez.",
        action: {
          label: "Abrir WhatsApp",
          onClick: () => {
            window.open(
              waMessageLink(
                customer.phone_e164,
                `Oi, ${firstName}! Seu acesso ao painel dos Caras das Legends: ${result.data.url}`,
              ),
              "_blank",
              "noopener",
            );
          },
        },
      });
      router.refresh();
    });
  };

  const chatLink = waMessageLink(customer.phone_e164, "");

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:gap-8 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link
            href="/admin/clientes"
            className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Clientes
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">
              {customer.name || "Sem nome"}
            </h2>
            <Badge variant="outline">{formatPhoneBR(customer.phone_e164)}</Badge>
            <Badge
              variant={customer.auth_user_id ? "default" : "secondary"}
              title={
                customer.auth_user_id
                  ? "Já entrou no painel"
                  : "Ainda não logou"
              }
            >
              {customer.auth_user_id ? "Painel ativo" : "Sem acesso"}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={generateInvite}
            disabled={invitePending}
          >
            <KeyRound />
            {invitePending ? "Gerando…" : "Gerar convite"}
          </Button>
          <Button asChild variant="outline">
            <a href={chatLink} target="_blank" rel="noopener noreferrer">
              <MessageCircle />
              WhatsApp
            </a>
          </Button>
          <Button variant="outline" onClick={() => setSheetOpen(true)}>
            <Pencil />
            Editar
          </Button>
          <Button
            variant={armed ? "destructive" : "outline"}
            onClick={remove}
            disabled={pending}
          >
            <Trash2 />
            {armed ? "Confirmar exclusão" : "Excluir"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Lotes" value={String(stats.total)} />
        <StatCard
          label="Arrematado"
          value={formatBRL(stats.totalValue)}
          hint="Cancelados fora"
        />
        <StatCard label="Pagos" value={String(stats.paid)} />
        <StatCard label="Enviados" value={String(stats.shipped)} />
        <StatCard
          label="Total pago"
          value={formatBRL(spending.paidTotal)}
          hint="Inclui os fretes cobrados"
        />
        <StatCard
          label="Pix em aberto"
          value={formatBRL(spending.openAmount)}
          hint="Cobranças ainda válidas"
        />
        <StatCard
          label="Próximo envio"
          value={nextShipment ? formatDateBR(nextShipment.batch_date) : "—"}
          hint={
            nextShipment
              ? `${SHIPMENT_STATUS_LABELS[nextShipment.status]} · ${nextShipment.code}`
              : "Sem envio pendente"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Cadastro</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Row label="Nome" value={customer.name ?? "—"} />
            <Row label="WhatsApp" value={formatPhoneBR(customer.phone_e164)} />
            <Row label="E-mail" value={customer.email ?? "—"} />
            <Row label="CPF/CNPJ" value={customer.cpf_cnpj ?? "—"} />
            <Row label="Convite" value={inviteLabel(invite)} />
            <Row label="Cadastrado em" value={<DateBR value={customer.created_at} />} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Observações</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap text-muted-foreground">
            {customer.notes || "Sem observações."}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Histórico de lotes</h3>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/lotes">Ver todos os lotes</Link>
          </Button>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Lote</TableHead>
                <TableHead className="text-right">Arremate</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Leilão</TableHead>
                <TableHead className="hidden md:table-cell">Envio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lots.map((lot) => (
                <TableRow key={lot.id}>
                  <TableCell className="font-mono text-xs">{lot.code}</TableCell>
                  <TableCell className="max-w-56">
                    <span className="block truncate">{lot.title}</span>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatBRL(lot.arremate_value)}
                  </TableCell>
                  <TableCell>
                    <LotStatusBadge status={lot.status} />
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                    {formatDateBR(lot.auction_date)}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                    {formatDateBR(lot.shipping_date)}
                  </TableCell>
                </TableRow>
              ))}

              {lots.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    <span className="text-muted-foreground">
                      {total === 0
                        ? "Este cliente ainda não arrematou nada."
                        : "Nenhum lote nesta página — use “Anterior” para voltar."}
                    </span>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {total > pageSize && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Página {page} de {pages} · {total} lotes
            </span>
            <div className="flex gap-2">
              {page > 1 ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`?lp=${page - 1}`}>
                    <ChevronLeft />
                    Anterior
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  <ChevronLeft />
                  Anterior
                </Button>
              )}
              {page < pages ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`?lp=${page + 1}`}>
                    Próxima
                    <ChevronRight />
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  Próxima
                  <ChevronRight />
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <CustomerFormSheet
        customer={customer}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function inviteLabel(invite: InviteStatus): ReactNode {
  switch (invite.status) {
    case "active":
      return invite.expires_at ? (
        <>
          Ativo até <DateBR value={invite.expires_at} />
        </>
      ) : (
        "Ativo"
      );
    case "used":
      return "Já usado";
    case "expired":
      return "Expirado";
    default:
      return "—";
  }
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
