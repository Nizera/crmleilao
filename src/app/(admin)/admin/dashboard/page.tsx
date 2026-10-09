import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  Coins,
  Package,
  Users,
} from "lucide-react";

import { requireAdmin, listCustomersPage, listStock, getPaymentKpis } from "@/lib/dal";
import { formatBRL } from "@/lib/lots";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Dashboard" };

const nextSteps = [
  {
    title: "Cadastrar clientes",
    href: "/admin/clientes",
    description:
      "Cadastre pelo número de WhatsApp — quem já tiver cadastro aparece no autocomplete.",
    icon: Users,
  },
  {
    title: "Lançar lotes arrematados",
    href: "/admin/lotes",
    description:
      "Código, descrição, valor, imagem e data de envio. O estoque baixa automático.",
    icon: Package,
  },
  {
    title: "Configurar cobranças",
    href: "/admin/cobrancas",
    description:
      "Mercado Pago para gerar Pix agrupado por cobrança — defina MP_ACCESS_TOKEN e MP_WEBHOOK_TOKEN.",
    icon: Coins,
  },
  {
    title: "Programar envios de terça",
    href: "/admin/envios",
    description:
      "Cotação SuperFrete, emissão de etiqueta e rastreio por cliente.",
    icon: CalendarClock,
  },
];

export default async function DashboardPage() {
  await requireAdmin();

  const stock = await listStock().catch(() => []);
  const customers = await listCustomersPage({ pageSize: 5 }).catch(() => null);
  const payments = await getPaymentKpis();
  const stockReady = stock.length > 0;

  const units = stock.reduce((sum, item) => sum + item.qty_on_hand, 0);
  const negatives = stock.filter((item) => item.qty_on_hand < 0).length;

  const monthLabel = new Date().toLocaleDateString("pt-BR", {
    month: "long",
  });

  const kpis = [
    {
      label: "Figurinhas em estoque",
      value: stockReady ? String(units) : "—",
      hint: stockReady
        ? `${stock.length} SKUs${negatives > 0 ? ` · ${negatives} negativo(s)` : ""}`
        : "aplique a migração 0003",
      icon: Package,
    },
    {
      label: "Clientes na base",
      value: customers ? String(customers.total) : "—",
      hint: customers
        ? "cadastro feito ao lançar o lote"
        : "falha ao consultar",
      icon: Users,
    },
    {
      label: "Faturamento do mês",
      value: formatBRL(payments.monthRevenue),
      hint: `lotes pagos em ${monthLabel}`,
      icon: Coins,
    },
    {
      label: "Pagamentos pendentes",
      value: payments.chargesReady ? String(payments.pendingCharges) : "—",
      hint: payments.chargesReady
        ? payments.pendingCharges > 0
          ? `${formatBRL(payments.pendingAmount)} em aberto`
          : "nenhuma cobrança aberta"
        : "aplique a migração 0005",
      icon: Coins,
    },
  ];

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:gap-8 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            Visão geral
          </h2>
          <p className="text-sm text-muted-foreground">
            Leilões de figurinhas da Copa 2026 — Caras das Legends
          </p>
        </div>
        <Badge variant="secondary">Fase 5 · base pronta</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {kpi.label}
              </CardTitle>
              <kpi.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{kpi.value}</div>
              <p className="text-xs text-muted-foreground">{kpi.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Próximos passos</CardTitle>
          <CardDescription>
            A base de autenticação, RLS e navegação já está de pé. O que falta
            para operar o leilão:
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {nextSteps.map((step) => (
            <Link
              key={step.href}
              href={step.href}
              className="group flex items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-accent/50"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted">
                <step.icon className="size-4" />
              </span>
              <span className="flex-1">
                <span className="flex items-center gap-1 font-medium group-hover:underline">
                  {step.title}
                  <ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {step.description}
                </span>
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
