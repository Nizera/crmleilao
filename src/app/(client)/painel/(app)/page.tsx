import { Award, Bolt, CircleDollarSign, Medal } from "lucide-react";
import Link from "next/link";

import {
  getCustomerSpendingSummary,
  getCustomerFreightState,
  listCustomerCharges,
  listLots,
  requireCustomer,
} from "@/lib/dal";
import { ClientChargesCard } from "@/components/client/charges-card";
import { ClientLotsList } from "@/components/client/client-lots-list";
import {
  chargeExpiryDeltaMs,
  isChargeActive,
  type Charge,
} from "@/lib/charges";
import { formatBRL, formatDateBR, type LotStatus } from "@/lib/lots";
import { cn } from "@/lib/utils";
import { selectHomeLots } from "@/lib/client-home";

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
  const [lots, charges, freight, spending] =
    await Promise.all([
      // Capa do card vem daqui; itens/descrição ficam só no detalhe do lote.
      listLots({ images: true, description: true }),
      listCustomerCharges(customer.id),
      getCustomerFreightState(customer.id),
      getCustomerSpendingSummary(customer.id),
    ]);

  const today = new Intl.DateTimeFormat("en-CA", {timeZone:"America/Sao_Paulo"}).format(new Date());
  const recentLots = selectHomeLots(lots,today);
  const olderLotsCount = lots.length - recentLots.length;

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

  const lotsSubtitle = `Lotes do leilão de ${formatDateBR(today)} e todos os pendentes de pagamento.`;

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

        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
            label="Total pago"
            value={formatBRL(spending.paidTotal)}
            sub="somente lotes; frete separado"
            icon={<CircleDollarSign className="size-3.5 text-ouro-ink" />}
          />
        </div>
      </section>

      <ClientChargesCard lots={lots} charges={homeCharges} freight={freight} showFreightStatus={false} />

      <ClientLotsList
        lots={recentLots}
        subtitle={lotsSubtitle ?? undefined}
      />
      {olderLotsCount > 0 && (
        <p className="-mt-2 text-center text-xs text-muted-foreground">
          Lotes de leilões anteriores ficam no{" "}
          <Link
            href="/painel/historico"
            className="underline transition hover:text-foreground"
          >
            histórico ({olderLotsCount})
          </Link>
          .
        </p>
      )}

    </div>
  );
}
