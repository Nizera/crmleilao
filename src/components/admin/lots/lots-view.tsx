"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  KeyRound,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { inviteLinkForCustomer } from "@/app/actions/invites";
import { getLotDetailAction, logWaMessage, setLotStatus } from "@/app/actions/lots";
import { LotStatusBadge } from "@/components/admin/lots/lot-status-badge";
import { LotFormSheet } from "@/components/admin/lots/lot-form";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  buildLotMessage,
  formatBRL,
  formatDateBR,
  LOT_STATUSES,
  LOT_STATUS_LABELS,
  waMessageLink,
  type Lot,
  type LotStatus,
} from "@/lib/lots";
import type { Player, StockItem } from "@/lib/stock";
import type { AppSettings } from "@/lib/settings";
import { spDayOf, spTimeOf, spToday } from "@/lib/dates";
import { LOT_SHIFTS, lotShiftRange, parseLotRange } from "@/lib/lot-filters";

const ALL = "all";

const formatQty = (qty: number | undefined) => (qty ? `${qty} un.` : "—");

export function LotsView({
  lots,
  total,
  page,
  pageSize,
  q,
  status,
  players,
  stock,
  settings,
  qtyByLot,
  dateFrom = "",
  dateTo = "",
  filterError = "",
}: {
  lots: Lot[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  status: string;
  players: Player[];
  stock: StockItem[];
  settings: AppSettings;
  qtyByLot: Map<string, number>;
  dateFrom?: string;
  dateTo?: string;
  filterError?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const [advanced, setAdvanced] = useState(Boolean(dateFrom || filterError));
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);
  const [day, setDay] = useState(dateFrom.slice(0, 10) || spToday());
  const [shift, setShift] = useState<keyof typeof LOT_SHIFTS>("day");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Lot | null>(null);
  const [pending, startTransition] = useTransition();

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const buildHref = (nextQuery: string, nextStatus: string, nextPage: number, range = { from: dateFrom, to: dateTo }) => {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (nextStatus !== ALL) params.set("status", nextStatus);
    if (nextPage > 1) params.set("p", String(nextPage));
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    const search = params.toString();
    return `/admin/lotes${search ? `?${search}` : ""}`;
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    router.replace(buildHref(query, status, 1));
  };

  const changeFilter = (value: string) => {
    router.replace(buildHref(query, value, 1));
  };

  const openNew = () => {
    setEditing(null);
    setSheetOpen(true);
  };

  const openEdit = (lot: Lot) => {
    // A lista é magra: itens, fotos e descrição vêm do detalhe, senão o form
    // abriria vazio e apagaria dados no próximo save.
    startTransition(async () => {
      const result = await getLotDetailAction(lot.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEditing(result.data);
      setSheetOpen(true);
    });
  };

  const changeStatus = (lot: Lot, next: LotStatus) => {
    if (next === lot.status) return;
    if (lot.charge_id && lot.status === "pending_payment" && !window.confirm(
      "Esta alteração encerrará o Pix aberto no Mercado Pago, incluindo os outros lotes dessa cobrança. O cliente poderá gerar um novo Pix com o total atualizado. Continuar?",
    )) return;
    startTransition(async () => {
      const result = await setLotStatus(lot.id, next);
      if (!result.ok) toast.error(result.error);
    });
  };

  const sendWhatsApp = (lot: Lot) => {
    if (!lot.customer) return;
    const text = buildLotMessage(lot, settings.wa_notice_template);
    const link = waMessageLink(lot.customer.phone_e164, text);
    window.open(link, "_blank", "noopener,noreferrer");
    startTransition(async () => {
      const result = await logWaMessage({
        lot_id: lot.id,
        kind: "auction_notice",
        text_body: text,
        link,
      });
      if (!result.ok) toast.error(result.error);
    });
  };

  // Cliente ainda sem senha: o botão manda o convite de acesso em vez da
  // mensagem de lote. Assim que ele define a senha, volta a mensagem.
  const sendInvite = (lot: Lot) => {
    const customer = lot.customer;
    if (!customer) return;
    startTransition(async () => {
      const result = await inviteLinkForCustomer(customer.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const url = result.data.url;
      const first = customer.name?.trim().split(" ")[0];
      const text = `Oi${first ? `, ${first}` : ""}! Seu acesso ao painel dos Caras das Legends: ${url}`;
      const link = waMessageLink(customer.phone_e164, text);
      window.open(link, "_blank", "noopener,noreferrer");

      const logged = await logWaMessage({
        customer_id: customer.id,
        kind: "access_invite",
        text_body: text,
        link,
      });
      if (!logged.ok) {
        toast.info(`Convite aberto, mas o registro falhou: ${logged.error}`);
      } else {
        toast.success("Convite aberto no WhatsApp.");
      }
    });
  };

  const hasAccess = (lot: Lot) => Boolean(lot.customer?.auth_user_id);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:gap-8 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Lotes</h2>
          <p className="text-sm text-muted-foreground">
            {total === 0
              ? "Nenhum lote encontrado."
              : `${total} ${total === 1 ? "lote encontrado" : "lotes encontrados"}${dateFrom ? " no período selecionado" : ""}.`}
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus />
          Novo lote
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={search} className="flex min-w-0 basis-full items-center gap-2 sm:flex-1 sm:basis-0">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por lote, código, cliente ou telefone"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline">
            Buscar
          </Button>
          {q && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setQuery("");
                router.replace(buildHref("", status, 1));
              }}
            >
              Limpar
            </Button>
          )}
        </form>

        <Select value={status} onValueChange={changeFilter}>
          <SelectTrigger className="w-full shrink-0 sm:w-56">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os status</SelectItem>
            {LOT_STATUSES.map((item) => (
              <SelectItem key={item} value={item}>
                {LOT_STATUS_LABELS[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" aria-expanded={advanced} onClick={() => {
          if (!advanced && !from && !to) { const range = lotShiftRange(day, shift); setFrom(range.from); setTo(range.to); }
          setAdvanced(!advanced);
        }}>
          Filtros avançados{dateFrom ? " · ativo" : ""}
        </Button>
      </div>

      {advanced && (
        <form className="min-w-0 space-y-4 rounded-lg border bg-muted/20 p-4" onSubmit={(event) => {
          event.preventDefault();
          const range = parseLotRange(from, to);
          if (range.error) return toast.error(range.error);
          router.replace(buildHref(query, status, 1, range));
        }}>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="min-w-0 space-y-1 text-sm">Dia do cadastro
              <Input type="date" value={day} onChange={(event) => {
                setDay(event.target.value);
                if (event.target.value) { const range = lotShiftRange(event.target.value, shift); setFrom(range.from); setTo(range.to); }
              }} />
            </label>
            <label className="min-w-0 space-y-1 text-sm">Atalho de período
              <select className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={shift} onChange={(event) => {
                const value = event.target.value as keyof typeof LOT_SHIFTS;
                setShift(value);
                if (day) { const range = lotShiftRange(day, value); setFrom(range.from); setTo(range.to); }
              }}>
                {Object.entries(LOT_SHIFTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <Button type="button" variant="outline" className="self-end" onClick={() => {
              const range = lotShiftRange(spToday(), "day"); setDay(spToday()); setShift("day"); setFrom(range.from); setTo(range.to);
            }}>Hoje</Button>
            <label className="min-w-0 space-y-1 text-sm">Início
              <Input type="datetime-local" required value={from} onChange={(event) => setFrom(event.target.value)} className="min-w-0" />
            </label>
            <label className="min-w-0 space-y-1 text-sm">Fim
              <Input type="datetime-local" required value={to} onChange={(event) => setTo(event.target.value)} className="min-w-0" />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">Horário de São Paulo. Filtra pela data/hora do cadastro. O início é incluído e o horário final fica para o próximo período. Você pode ajustar os horários livremente.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Aplicar filtros</Button>
            <Button type="button" variant="outline" onClick={() => { setFrom(""); setTo(""); setQuery(""); router.replace("/admin/lotes"); }}>Limpar todos os filtros</Button>
          </div>
        </form>
      )}
      {filterError && <p role="alert" className="text-sm text-destructive">{filterError}</p>}

      <div className="min-w-0 rounded-md border">
        <Table className="min-w-[940px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[72px]">Código</TableHead>
              <TableHead className="w-[104px]" title="Data e hora do cadastro, no horário de São Paulo">Cadastro</TableHead>
              <TableHead className="w-[22%]">Cliente</TableHead>
              <TableHead>Lote</TableHead>
              <TableHead className="hidden w-20 text-right text-xs md:table-cell">
                Figurinhas
              </TableHead>
              <TableHead className="w-[88px] text-right">Arremate</TableHead>
              <TableHead className="w-[152px]">Status</TableHead>
              <TableHead className="hidden w-24 md:table-cell">Envio</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lots.map((lot) => (
              <TableRow key={lot.id}>
                <TableCell className="font-mono text-xs">{lot.code}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  <time dateTime={lot.created_at} title="Horário de São Paulo">
                    <span className="block text-sm">{formatDateBR(spDayOf(lot.created_at))}</span>
                    <span className="block text-xs text-muted-foreground">{spTimeOf(lot.created_at)}</span>
                  </time>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex min-w-0 flex-col">
                    <span className="line-clamp-2 break-words font-medium" title={lot.customer?.name ?? "Sem nome"}>
                      {lot.customer?.name ?? "Sem nome"}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {lot.customer?.phone_e164 ?? "—"}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <span className="line-clamp-2 break-words" title={lot.title}>{lot.title}</span>
                </TableCell>
                <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">
                  {formatQty(qtyByLot.get(lot.id))}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatBRL(lot.arremate_value)}
                </TableCell>
                <TableCell className="whitespace-normal [&_[data-slot=badge]]:h-auto [&_[data-slot=badge]]:max-w-full [&_[data-slot=badge]]:whitespace-normal [&_[data-slot=badge]]:text-center">
                  <LotStatusBadge status={lot.status} size="sm" />
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                  {formatDateBR(lot.shipping_date)}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        disabled={pending}
                        aria-label={`Ações do lote ${lot.code}`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem onSelect={() => openEdit(lot)}>
                        <Pencil />
                        Editar
                      </DropdownMenuItem>
                      {hasAccess(lot) ? (
                        <DropdownMenuItem
                          disabled={!lot.customer}
                          onSelect={() => sendWhatsApp(lot)}
                        >
                          <MessageCircle />
                          Mensagem do lote
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          disabled={!lot.customer}
                          onSelect={() => sendInvite(lot)}
                        >
                          <KeyRound />
                          Enviar convite
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        Mudar status
                      </DropdownMenuLabel>
                      {LOT_STATUSES.map((item) => (
                        <DropdownMenuItem
                          key={item}
                          disabled={item === lot.status}
                          onSelect={() => changeStatus(lot, item)}
                        >
                          {LOT_STATUS_LABELS[item]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}

            {lots.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center">
                  <span className="text-muted-foreground">
                    {total === 0 && !q && status === ALL
                      ? "Cadastre o primeiro arremate com o botão “Novo lote”."
                      : "Nenhum lote corresponde à busca."}
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
                <Link href={buildHref(q, status, page - 1)}>
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
                <Link href={buildHref(q, status, page + 1)}>
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

      <LotFormSheet
        lot={editing}
        players={players}
        stock={stock}
        bidIncrement={settings.bid_increment}
        shippingWeekday={settings.shipping_weekday}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setEditing(null);
        }}
      />
    </div>
  );
}
