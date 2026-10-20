"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, History, QrCode, Truck } from "lucide-react";

import { ChargeStatusBadge } from "@/components/admin/charges/charge-status-badge";
import { LotStatusBadge } from "@/components/admin/lots/lot-status-badge";
import { ShipmentStatusBadge } from "@/components/admin/shipments/shipment-status-badge";
import { useChargeQr } from "@/components/client/charge-qr-sheet";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { DateBR } from "@/components/ui/date-br";
import { effectiveChargeStatus, isChargeActive, type Charge } from "@/lib/charges";
import { spDayOf } from "@/lib/dates";
import { formatBRL, formatDateBR, type Lot } from "@/lib/lots";
import type { Shipment } from "@/lib/shipments";

type Tab = "lotes" | "pagamentos" | "envios";

type Group = { key: string; label: string; items: unknown[] };

type Props = {
  lots: Lot[];
  charges: Charge[];
  shipments: Shipment[];
};

const PAGE_SIZE = 10;

const dayOf = (iso: string | null | undefined): string => (iso ? spDayOf(iso) : "");

/** Dia do agrupamento de uma cobrança: último leilão envolvido (pode misturar). */
function chargeDay(charge: Charge): string {
  const dates = (charge.lots ?? [])
    .map((lot) => dayOf(lot.auction_date))
    .filter(Boolean)
    .sort();
  return dates.at(-1) ?? dayOf(charge.created_at);
}

function shipmentDay(shipment: Shipment): string {
  return dayOf(shipment.batch_date) || dayOf(shipment.created_at);
}

const shortDay = (day: string): string => day.split("-").slice(1).reverse().join("/");

function longDay(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}

function buildGroups<T>(
  items: T[],
  getDay: (item: T) => string,
  label: (day: string) => string,
): Group[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const day = getDay(item);
    const bucket = map.get(day);
    if (bucket) bucket.push(item);
    else map.set(day, [item]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === b ? 0 : a < b ? 1 : -1))
    .map(([key, bucket]) => ({ key, label: label(key), items: bucket as unknown[] }));
}

function LotRow({ lot }: { lot: Lot }) {
  return (
    <Link
      href={`/painel/lotes/${lot.code}`}
      className="flex items-center justify-between gap-3 rounded-md border p-3 transition hover:bg-muted/50"
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">
          {lot.code} · {lot.title}
        </span>
        <span className="text-xs text-muted-foreground">{formatBRL(lot.arremate_value)}</span>
      </span>
      <LotStatusBadge status={lot.status} />
    </Link>
  );
}

/** Chips clicáveis dos lotes de um Pix ou de um envio. */
function LotChips({
  lots,
}: {
  lots: readonly { id: string; code: string; title: string }[];
}) {
  if (lots.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {lots.map((lot) => (
        <Link
          key={lot.id}
          href={`/painel/lotes/${lot.code}`}
          title={`${lot.code} · ${lot.title}`}
          className="inline-block max-w-44 truncate rounded border px-2 py-0.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          {lot.code} · {lot.title}
        </Link>
      ))}
    </span>
  );
}

function ChargeRow({ charge }: { charge: Charge }) {
  const status = effectiveChargeStatus(charge);
  const active = isChargeActive(charge);
  const lots = charge.lots ?? [];
  const qr = useChargeQr();

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between">
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate font-medium">
          {lots.length > 0 ? `${lots.length} ${lots.length === 1 ? "lote" : "lotes"} · ${charge.code}` : charge.code}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatBRL(charge.amount)}
          {charge.paid_at ? (
            <>
              {" · pago em "}
              <DateBR value={charge.paid_at} />
            </>
          ) : null}
        </span>
        <LotChips lots={lots} />
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <ChargeStatusBadge status={status} />
        {active && (
          <Button size="sm" onClick={() => qr.open(charge.id)}>
            <QrCode />
            Pagar
          </Button>
        )}
      </span>
      {qr.sheet}
    </div>
  );
}

function ShipmentRow({ shipment }: { shipment: Shipment }) {
  const lots = shipment.lots ?? [];
  const lotCount = lots.length;

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between">
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-center gap-2 truncate font-medium">
          <Truck className="size-4 shrink-0 text-muted-foreground" />
          {shipment.carrier ?? shipment.service_name ?? "Envio"} ·{" "}
          {lotCount} {lotCount === 1 ? "lote" : "lotes"}
        </span>
        <span className="text-xs text-muted-foreground">
          {shipment.tracking_code ?? `postado em ${formatDateBR(dayOf(shipment.created_at))}`}
        </span>
        <LotChips lots={lots} />
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <ShipmentStatusBadge status={shipment.status} />
        {shipment.tracking_url && (
          <a
            href={shipment.tracking_url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Rastrear o envio ${shipment.code}`}
            className="text-muted-foreground transition hover:text-foreground"
          >
            <ExternalLink className="size-4" />
          </a>
        )}
      </span>
    </div>
  );
}

export function ClientHistoryView({ lots, charges, shipments }: Props) {
  const [tab, setTab] = useState<Tab>("lotes");
  const [day, setDay] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const allGroups = useMemo<Group[]>(() => {
    const label = (prefix: string) => (key: string) => `${prefix} de ${longDay(key)}`;

    if (tab === "lotes") {
      return buildGroups(lots, (lot) => dayOf(lot.auction_date), label("Leilão"));
    }
    if (tab === "pagamentos") {
      return buildGroups(charges, chargeDay, label("Leilão"));
    }
    return buildGroups(shipments, shipmentDay, label("Envio"));
  }, [tab, lots, charges, shipments]);

  const dayOptions = useMemo(() => allGroups.map((group) => group.key), [allGroups]);

  const filteredGroups = useMemo(
    () => (day ? allGroups.filter((group) => group.key === day) : allGroups),
    [allGroups, day],
  );

  const { shownGroups, hasMore } = useMemo(() => {
    let budget = visible;
    const out: Group[] = [];
    for (const group of filteredGroups) {
      if (budget <= 0) break;
      const items = group.items.slice(0, budget);
      budget -= items.length;
      out.push({ ...group, items });
    }
    const total = filteredGroups.reduce((sum, group) => sum + group.items.length, 0);
    const shown = out.reduce((sum, group) => sum + group.items.length, 0);
    return { shownGroups: out, hasMore: shown < total };
  }, [filteredGroups, visible]);

  const changeTab = (next: Tab) => {
    setTab(next);
    setDay(null);
    setVisible(PAGE_SIZE);
  };

  const pickDay = (next: string | null) => {
    setDay(next);
    setVisible(PAGE_SIZE);
  };

  const renderRow = (item: unknown, key: string): ReactNode => {
    if (tab === "lotes") return <LotRow key={key} lot={item as Lot} />;
    if (tab === "pagamentos") return <ChargeRow key={key} charge={item as Charge} />;
    return <ShipmentRow key={key} shipment={item as Shipment} />;
  };

  const emptyCopy =
    tab === "lotes"
      ? "Nenhum lote registrado."
      : tab === "pagamentos"
        ? "Nenhuma cobrança registrada."
        : "Nenhum envio registrado.";

  const emptyImage =
    tab === "lotes"
      ? "/brand/empty-lots.png"
      : tab === "pagamentos"
        ? "/brand/empty-pix.png"
        : "/brand/empty-shipments.png";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-1 overflow-x-auto border-b">
        {(
          [
            ["lotes", "Lotes"],
            ["pagamentos", "Pagamentos"],
            ["envios", "Envios"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => changeTab(key)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {dayOptions.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={day === null ? "default" : "outline"}
            onClick={() => pickDay(null)}
          >
            <History />
            Todos
          </Button>
          {dayOptions.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={day === option ? "default" : "outline"}
              onClick={() => pickDay(option)}
              title={`Leilão de ${formatDateBR(option)}`}
            >
              {shortDay(option)}
            </Button>
          ))}
        </div>
      )}

      {allGroups.length === 0 && (
        <EmptyState image={emptyImage} title={emptyCopy} />
      )}

      {shownGroups.map((group) => (
        <section key={group.key} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-muted-foreground">{group.label}</h3>
          <div className="flex flex-col gap-2">
            {group.items.map((item, index) => renderRow(item, `${group.key}-${index}`))}
          </div>
        </section>
      ))}

      {hasMore && (
        <Button variant="outline" onClick={() => setVisible((count) => count + PAGE_SIZE)}>
          Carregar mais
        </Button>
      )}
    </div>
  );
}
