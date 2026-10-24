import { Award, Bolt, CircleDollarSign, Gift, Medal, Truck } from "lucide-react";
import Link from "next/link";

import {
  countCustomerShipments,
  getCustomerSpendingSummary,
  getCustomerFreightState,
  listCustomerCharges,
  listCustomerShipments,
  listLots,
  requireCustomer,
} from "@/lib/dal";
import { ClientChargesCard } from "@/components/client/charges-card";
import { ClientShipmentsCard } from "@/components/client/shipments-card";
import { ClientLotsList } from "@/components/client/client-lots-list";
import {
  chargeExpiryDeltaMs,
  isChargeActive,
  type Charge,
} from "@/lib/charges";
import { formatBRL, formatDateBR, type LotStatus } from "@/lib/lots";
import { cn } from "@/lib/utils";

const PAID_LOT_STATUSES: LotStatus[] = ["paid", "shipped", "delivered"];

/** "Expira 2h" / "Expira 3 dias" / "Prazo vencido" — espelho do card de cobrança. */
function kpiExpiry(charge: Pick<Charge, "status" | "expires_at">) {
  const delta = chargeExpiryDeltaMs(charge, new Date());
  if (delta == null) return null;
  if (delta <= 0) return "Prazo vencido";
  const hours = Math.round(delta / 3_600_000);
  if (hours < 48) return `Expira ${hours}h`;
  return `Expira ${Math.round(hours / 24)} dias`;
}

function KpiCard({
  label,
  value,
  sub,
  icon,
  pulse,
  subClassName,
}: {
  label: string;
  value: string;
  sub: string | null;
  icon: React.ReactNode;
  pulse?: boolean;
  subClassName?: string;
}) {
  return (
    <div className="flex flex-col rounded-xl bg-card p-2.5 shadow-sm ring-1 ring-foreground/10">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase text-muted-foreground">
          {label}
        </span>
        {pulse ? (
          <span className="size-1.5 animate-pulse rounded-full bg-amarelo" />
        ) : (
          icon
        )}
      </div>
      <span className="mt-1 truncate text-lg font-bold tracking-tight">
        {value}
      </span>
      {sub && (
        <span
          className={cn(
            "truncate text-[9px] font-medium uppercase tracking-tight text-muted-foreground",
            subClassName,
          )}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

export default async function ClientHomePage() {
  const { customer } = await requireCustomer();
  // Listas ficam capadas; os contadores são head-count para o badge não
  // mostrar o teto do fetch como se fosse o total.
  const [lots, charges, shipments, shipmentsTotal, freight, spending] =
    await Promise.all([
      // Capa do card vem daqui; itens/descrição ficam só no detalhe do lote.
      listLots({ images: true }),
      listCustomerCharges(customer.id),
      listCustomerShipments(customer.id),
      countCustomerShipments(customer.id),
      getCustomerFreightState(customer.id),
      getCustomerSpendingSummary(customer.id),
    ]);

  // A home é de ação: só o último leilão. O resto fica em /painel/historico.
  const latestAuctionDay = lots.reduce<string | null>(
    (acc, lot) => (acc === null || lot.auction_date > acc ? lot.auction_date : acc),
    null,
  );
  const recentLots = latestAuctionDay
    ? lots.filter((lot) => lot.auction_date === latestAuctionDay)
    : [];
  const olderLotsCount = lots.length - recentLots.length;

  // A home de pagamentos é do dia: só cobranças do leilão vigente + as que
  // em aberto (pendentes de qualquer dia, para o cliente poder pagar).
  // Pagas/canceladas/expiradas de dias anteriores ficam em /painel/historico.
  // Data "hoje" em São Paulo — o form do lote grava auction_date no fuso do
  // admin, então comparar com a data local evita errar após as 21h (UTC-3).
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  const activeCharge = charges.find((charge) => isChargeActive(charge)) ?? null;
  const homeCharges = charges
    .filter(
      (charge) =>
        isChargeActive(charge) ||
        (charge.lots ?? []).some((lot) => lot.auction_date === today),
    )
    .slice(0, 5);
  if (activeCharge && !homeCharges.some((charge) => charge.id === activeCharge.id)) {
    homeCharges.push(activeCharge);
  }

  // KPIs da home usam valores confirmados e estados atuais do cliente.
  const paidLotsCount = lots.filter((lot) =>
    PAID_LOT_STATUSES.includes(lot.status),
  ).length;
  const upcomingShipments = shipments.filter(
    (shipment) => shipment.status !== "cancelled" && shipment.status !== "delivered",
  );
  const nextBatchDate = upcomingShipments.reduce<string | null>(
    (acc, shipment) =>
      acc === null || shipment.batch_date < acc ? shipment.batch_date : acc,
    null,
  );

  // "A Pagar": vale o Pix aberto; sem Pix, a soma dos lotes aguardando
  // pagamento + frete da semana em aberto (o cliente deve ver o total
  // mesmo antes de gerar o cobrança).
  const pendingLots = lots.filter((lot) => lot.status === "pending_payment");
  const pendingLotsTotal = pendingLots.reduce(
    (sum, lot) => sum + Number(lot.arremate_value),
    0,
  );
  const freightDueExtra = freight.status === "due" ? freight.amount : 0;
  const owedTotal = pendingLotsTotal + freightDueExtra;
  const owedValue = activeCharge
    ? formatBRL(Number(activeCharge.amount))
    : owedTotal > 0
      ? formatBRL(owedTotal)
      : "R$ —";
  const owedSub = activeCharge
    ? (kpiExpiry(activeCharge) ?? "Pix aberto")
    : owedTotal > 0
      ? freightDueExtra > 0 && pendingLots.length === 0
        ? "Frete da semana"
        : `${pendingLots.length} ${pendingLots.length === 1 ? "lote aguardando" : "lotes aguardando"}${freightDueExtra > 0 ? " + frete" : ""}`
      : "Tudo em dia";
  const owedActive = Boolean(activeCharge) || owedTotal > 0;

  const lotsSubtitle =
    lots.length === 0
      ? null
      : latestAuctionDay
        ? `${recentLots.length} ${recentLots.length === 1 ? "lote arrematado" : "lotes arrematados"} no leilão de ${formatDateBR(latestAuctionDay)}.`
        : `${lots.length} ${lots.length === 1 ? "lote arrematado" : "lotes arrematados"} por você.`;

  return (
    <div className="flex flex-col gap-4">
      {/* Hero: saudação + chips de status + chip de raridade (placeholder). */}
      <section className="flex flex-col gap-2 pt-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <h1 className="flex truncate items-center gap-1.5 text-xl font-semibold tracking-tight">
              Olá{customer.name ? `, ${customer.name.split(" ")[0]}` : ""}{" "}
              <span className="text-base">👋</span>
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              Acompanhe seus lotes, pagamentos e envios do leilão.
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-amarelo/15 px-2.5 py-1 text-ouro-ink ring-1 ring-ouro/30">
            <Award className="size-4 text-amarelo" />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Ouro NV.4
            </span>
          </span>
        </div>

        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KpiCard
            label="A Pagar"
            value={owedValue}
            sub={owedSub}
            icon={<Bolt className="size-3.5 text-muted-foreground" />}
            pulse={owedActive}
            subClassName={owedActive ? "text-ouro-ink" : undefined}
          />
          <KpiCard
            label="Lotes"
            value={String(lots.length).padStart(2, "0")}
            sub={
              paidLotsCount > 0
                ? `${paidLotsCount} ${paidLotsCount === 1 ? "pago" : "pagos"}`
                : "Nenhum pago"
            }
            icon={<Medal className="size-3.5 text-amarelo" />}
          />
          <KpiCard
            label="Envios"
            value={String(shipmentsTotal).padStart(2, "0")}
            sub={nextBatchDate ? `Saída ${formatDateBR(nextBatchDate)}` : "Sem saída"}
            icon={<Truck className="size-3.5 text-ouro-ink" />}
          />
          <KpiCard
            label="Total pago"
            value={formatBRL(spending.paidTotal)}
            sub="somente lotes; frete separado"
            icon={<CircleDollarSign className="size-3.5 text-ouro-ink" />}
          />
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2">
        <Link href="/painel/loja" className="flex min-w-0 items-center gap-2 rounded-xl border border-ouro/25 bg-card p-3 shadow-sm transition hover:border-ouro/50 sm:gap-3">
          <span className="rounded-lg bg-amarelo/15 p-2 text-ouro-ink"><Gift className="size-5" /></span>
          <span className="min-w-0 flex-1"><strong className="block text-sm">Loja de pontos</strong><span className="block text-xs text-muted-foreground">Recompensas e extrato</span></span>
          <span className="text-lg text-ouro-ink" aria-hidden="true">→</span>
        </Link>
        <Link href="/painel/ranking" className="flex min-w-0 items-center gap-2 rounded-xl border border-ouro/25 bg-card p-3 shadow-sm transition hover:border-ouro/50 sm:gap-3">
          <span className="rounded-lg bg-amarelo/15 p-2 text-ouro-ink"><Medal className="size-5" /></span>
          <span className="min-w-0 flex-1"><strong className="block text-sm">Meu ranking</strong><span className="block text-xs text-muted-foreground">Elo e líderes</span></span>
          <span className="text-lg text-ouro-ink" aria-hidden="true">→</span>
        </Link>
      </div>

      <ClientChargesCard lots={lots} charges={homeCharges} freight={freight} />

      <ClientLotsList
        lots={recentLots.length > 0 ? recentLots : lots}
        subtitle={lotsSubtitle ?? undefined}
      />
      {olderLotsCount > 0 && (
        <p className="-mt-2 text-center text-xs text-muted-foreground">
          Lotes de leilões anteriores ficam no{" "}
          <Link
            href="/painel/historico"
            className="underline transition hover:text-foreground"
          >
            histórico ({lots.length})
          </Link>
          .
        </p>
      )}

      <ClientShipmentsCard shipments={shipments} total={shipmentsTotal} />
    </div>
  );
}
