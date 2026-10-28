import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import {
  ArrowRightIcon,
  CalendarClockIcon,
  CircleCheckIcon,
  ClockIcon,
  CoinsIcon,
  PercentIcon,
  SunIcon,
  TruckIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";

import { getDashboardStats } from "@/lib/analytics";
import { PIPELINE_COLORS } from "@/lib/chart-colors";
import { requireAdmin } from "@/lib/dal";
import {
  isIsoDay,
  spDayLongLabel,
  spDayOf,
  spMonthLabel,
  spPrevMonthLabel,
  spToday,
} from "@/lib/dates";
import { formatBRL, formatDateBR } from "@/lib/lots";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashboardDatePicker } from "@/components/admin/dashboard/dashboard-date-picker";
import { FreightPeriodCard } from "@/components/admin/dashboard/freight-week-card";
import { PipelineChart } from "@/components/admin/dashboard/pipeline-chart";
import { RevenueChart } from "@/components/admin/dashboard/revenue-chart";
import { ClosingCard } from "@/components/admin/dashboard/closing-card";
import { resolveAuctionPeriod } from "@/lib/auction-period";

export const metadata = { title: "Dashboard" };

type Icon = ComponentType<{ className?: string }>;

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  danger,
}: {
  label: string;
  value: string;
  hint: ReactNode;
  icon: Icon;
  danger?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div
          className={`text-2xl font-bold tabular-nums ${danger ? "text-rose-500" : ""}`}
        >
          {value}
        </div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

type Alert = {
  tone: "red" | "amber" | "info";
  text: string;
  href: string;
  action: string;
};

const ALERT_ICON: Record<Alert["tone"], Icon> = {
  red: TriangleAlertIcon,
  amber: TriangleAlertIcon,
  info: CalendarClockIcon,
};

const ALERT_COLOR: Record<Alert["tone"], string> = {
  red: "text-rose-500",
  amber: "text-amber-500",
  info: "text-muted-foreground",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; from?: string; to?: string }>;
}) {
  await requireAdmin();
  const { d, from, to } = await searchParams;
  const today = spToday();
  let period = resolveAuctionPeriod(isIsoDay(d) ? d : today);
  let periodError: string | null = null;
  try {
    period = resolveAuctionPeriod(isIsoDay(d) ? d : today, { from, to });
  } catch (error) {
    periodError = error instanceof Error ? error.message : "Período inválido.";
  }
  const day = period.day;

  const s = await getDashboardStats(day, period.from, period.to);

  const monthLabel = spMonthLabel(today);
  const prevMonthLabel = spPrevMonthLabel(today);
  const dayCap =
    spDayLongLabel(day).charAt(0).toUpperCase() + spDayLongLabel(day).slice(1);

  const pendingLots =
    s.pipeline.find((row) => row.status === "pending_payment")?.count ?? 0;

  const alerts: Alert[] = [];
  if (s.ready.customers && s.customers.withoutEmail > 0) {
    alerts.push({
      tone: "amber",
      text: `${s.customers.withoutEmail} cliente(s) sem e-mail — não conseguem gerar Pix.`,
      href: "/admin/clientes",
      action: "Completar ficha",
    });
  }
  if (s.ready.lots && pendingLots > 0) {
    alerts.push({
      tone: "amber",
      text: `${pendingLots} lote(s) aguardando pagamento.`,
      href: "/admin/cobrancas",
      action: "Gerar cobrança",
    });
  }
  if (s.ready.charges && s.charges.expiring24h > 0) {
    alerts.push({
      tone: "amber",
      text: `${s.charges.expiring24h} cobrança(s) vencem em até 24 horas.`,
      href: "/admin/cobrancas",
      action: "Ver cobranças",
    });
  }
  if (s.nextBatch) {
    alerts.push({
      tone: "info",
      text: `${s.nextBatch.count} lote(s) pagos entram na postagem de ${formatDateBR(s.nextBatch.shippingDate)}.`,
      href: "/admin/envios",
      action: "Ver envios",
    });
  }

  const deltaHint =
    s.revenue.deltaPct === null
      ? s.revenue.prevMonth > 0
        ? `mês anterior: ${formatBRL(s.revenue.prevMonth)}`
        : "sem base de comparação"
      : null;

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:gap-8 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Visão geral
            </h2>
            <p className="text-sm text-muted-foreground">
              Leilão diário de colecionáveis — Os Caras das Legends
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{dayCap}</Badge>
        </div>
      </div>
      <DashboardDatePicker key={period.from + period.to} period={period} today={today} />
      {periodError && <p role="alert" className="text-sm text-destructive">{periodError} Mostrando o dia completo de {formatDateBR(day)}.</p>}
      <p className="-mt-3 text-xs text-muted-foreground">Período selecionado: {period.label}. Todos os indicadores, listas e fretes consideram os lotes cadastrados nesse intervalo. Somente faturamento do mês e acumulado são gerais, sem o corte do filtro.</p>

      {/* KPIs financeiros */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Faturamento do mês"
          value={s.ready.lots ? formatBRL(s.revenue.month) : "—"}
          icon={CoinsIcon}
          hint={
            s.revenue.deltaPct !== null ? (
              <span
                className={
                  s.revenue.deltaPct >= 0 ? "text-emerald-500" : "text-rose-500"
                }
              >
                {s.revenue.deltaPct >= 0 ? (
                  <TrendingUpIcon className="mr-0.5 inline size-3" />
                ) : (
                  <TrendingDownIcon className="mr-0.5 inline size-3" />
                )}
                {Math.abs(s.revenue.deltaPct)}% vs. {prevMonthLabel}
              </span>
            ) : (
              `${monthLabel} · recebimentos confirmados${deltaHint ? ` · ${deltaHint}` : ""}`
            )
          }
        />
        <KpiCard
          label="Faturamento acumulado"
          value={s.ready.lots ? formatBRL(s.revenue.total) : "—"}
          icon={WalletIcon}
          hint={
            s.ready.lots
              ? `${s.revenue.paidLots} ${s.revenue.paidLots === 1 ? "lote pago" : "lotes pagos"}`
              : "aplique a migração 0002_lots.sql"
          }
        />
        <KpiCard
          label="Ticket médio"
          value={s.ready.lots ? formatBRL(s.revenue.ticket) : "—"}
          icon={TrendingUpIcon}
          hint="por lote pago do período"
        />
        <KpiCard
          label="A receber do período"
          value={s.ready.charges ? formatBRL(s.charges.openAmount) : "—"}
          icon={ClockIcon}
          hint={
            s.ready.charges
              ? s.charges.pendingLotsCount > 0
                ? `${s.charges.pendingLotsCount} lote(s) pendente(s) · ${s.charges.openCount} Pix aberto(s)${
                    s.charges.expiring24h > 0
                      ? ` · ${s.charges.expiring24h} vencem em 24h`
                      : ""
                  }`
                : "nenhum lote pendente no período"
              : "aplique a migração 0005_charges.sql"
          }
        />
      </div>

      {/* KPIs de operação */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Conversão Pix"
          value={
            !s.ready.charges || s.charges.approvalRate === null
              ? "—"
              : `${Math.round(s.charges.approvalRate * 100)}%`
          }
          icon={PercentIcon}
          hint={
            !s.ready.charges
              ? "aplique a migração 0005_charges.sql"
              : s.charges.approvalRate === null
                ? "sem Pix vinculado aos lotes do período"
                : `${s.charges.recentApproved} de ${s.charges.recentCreated} Pix dos lotes do período pagos`
          }
        />
        <KpiCard
          label="Clientes"
          value={s.ready.customers ? String(s.customers.total) : "—"}
          icon={UsersIcon}
          hint={
            s.ready.customers
              ? `${s.customers.total} participante(s) · ${s.customers.newInPeriod} novo(s) no período`
              : "falha ao consultar"
          }
        />
        <KpiCard
          label="Envios a postar"
          value={s.ready.shipments ? String(s.shipments.toShip) : "—"}
          icon={TruckIcon}
          hint={
            s.ready.shipments
              ? `${s.shipments.posted} em trânsito · ${s.shipments.delivered} entregues`
              : "aplique a migração 0006_shipments.sql"
          }
        />
        <KpiCard
          label="Faturamento do período"
          value={s.ready.lots ? formatBRL(s.revenue.day) : "—"}
          icon={SunIcon}
          hint={
            s.ready.lots
              ? `${s.revenue.dayLots} ${
                  s.revenue.dayLots === 1 ? "lote cadastrado" : "lotes cadastrados"
                } no período selecionado`
              : "aplique a migração 0002_lots.sql"
          }
        />
      </div>

      {/* Fechamento + frete lado a lado no desktop */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ClosingCard
          closing={s.closing}
          ready={s.ready.closing}
          key={period.from + period.to}
          period={period}
        />
        <FreightPeriodCard key={period.from + period.to} stats={s.freight} period={period} ready={s.ready.freight} />
      </div>

      {/* Gráficos */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recebido dos lotes do período</CardTitle>
            <CardDescription>
              Agrupado pelo mês de cadastro dos lotes selecionados · só pagamentos confirmados
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RevenueChart
              data={s.revenue.months.map((m) => ({
                label: m.label,
                value: m.value,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pipeline de lotes</CardTitle>
            <CardDescription>Lotes cadastrados no período selecionado</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <PipelineChart
              data={s.pipeline
                .filter((row) => row.count > 0)
                .map((row) => ({
                  status: row.status,
                  label: row.label,
                  count: row.count,
                }))}
            />
            <div className="flex flex-col gap-2">
              {s.pipeline.map((row) => (
                <div key={row.status} className="flex items-center gap-2 text-sm">
                  <span
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{
                      backgroundColor:
                        PIPELINE_COLORS[row.status] ?? "var(--chart-1)",
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {row.count}
                  </span>
                  <span className="w-24 text-right font-medium tabular-nums">
                    {formatBRL(row.value)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Listas */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Top clientes</CardTitle>
            <CardDescription>Maior valor pago em lotes do período</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {s.ranking.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhum lote pago ainda — o ranking aparece aqui.
              </p>
            )}
            {s.ranking.map((row, index) => (
              <Link
                key={row.id}
                href={`/admin/clientes/${row.id}`}
                className="group flex items-center gap-3 rounded-md border p-2.5 transition hover:bg-muted/50"
              >
                <Badge
                  variant={index === 0 ? "default" : "secondary"}
                  className="w-9 justify-center tabular-nums"
                >
                  {index + 1}º
                </Badge>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium group-hover:underline">
                    {row.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {row.lots} {row.lots === 1 ? "lote" : "lotes"}
                  </span>
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatBRL(row.total)}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Últimos pagamentos</CardTitle>
            <CardDescription>Lotes do período · mais recentes primeiro</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {s.recentPayments.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhum pagamento confirmado ainda.
              </p>
            )}
            {s.recentPayments.map((row) => (
              <div
                key={row.code}
                className="flex items-center gap-3 rounded-md border p-2.5"
              >
                <CircleCheckIcon className="size-4 shrink-0 text-emerald-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {row.customer}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {row.title}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-sm font-semibold tabular-nums">
                    {formatBRL(row.value)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateBR(spDayOf(row.paidAt))}
                  </span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pendências</CardTitle>
            <CardDescription>Pendências dos lotes do período</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {alerts.length === 0 && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
                <CircleCheckIcon className="size-4 shrink-0" />
                Tudo em dia — nenhuma pendência.
              </div>
            )}
            {alerts.map((alert) => {
              const AlertIcon = ALERT_ICON[alert.tone];
              return (
                <Link
                  key={alert.text}
                  href={alert.href}
                  className="group flex items-start gap-3 rounded-md border p-3 transition hover:bg-muted/50"
                >
                  <AlertIcon
                    className={`mt-0.5 size-4 shrink-0 ${ALERT_COLOR[alert.tone]}`}
                  />
                  <span className="min-w-0 flex-1 text-sm">{alert.text}</span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground">
                    {alert.action}
                    <ArrowRightIcon className="size-3.5" />
                  </span>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
