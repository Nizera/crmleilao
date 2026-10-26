/**
 * Frete da semana: cobrança fixa única por período de terça a terça.
 * Pure functions (seguras no cliente e no servidor) — as consultas ficam em
 * freight-server.ts / dal.ts.
 */

/** Valor fixo do frete semanal cobrado do cliente (1x por período). */
export const WEEKLY_FREIGHT = 20;

export type FreightDayKey = "ter" | "qua" | "qui" | "sex" | "sab" | "dom" | "seg";

/** Dias exibidos no card do dashboard (a semana da operação: terça a segunda). */
export const FREIGHT_DAYS: { key: FreightDayKey; label: string }[] = [
  { key: "ter", label: "Ter" },
  { key: "qua", label: "Qua" },
  { key: "qui", label: "Qui" },
  { key: "sex", label: "Sex" },
  { key: "sab", label: "Sáb" },
  { key: "dom", label: "Dom" },
  { key: "seg", label: "Seg" },
];

/** Estado do frete semanal do cliente logado (painel). */
export type CustomerFreightStatus = "none" | "due" | "awaiting" | "paid";

export type CustomerFreightState = {
  status: CustomerFreightStatus;
  amount: number;
  periodStart: string;
  /** Cobrança aberta que já inclui o frete (quando status === "awaiting"). */
  chargeCode?: string;
};

/** Agregados do frete pago no período corrente (dashboard do admin). */
export type FreightWeekStats = {
  periodStart: string;
  periodEnd: string;
  total: number;
  byDay: Record<FreightDayKey, number>;
  paidCount: number;
  pendingCount: number;
};

const TIME_ZONE = "America/Sao_Paulo";

/** Data civil em São Paulo (YYYY-MM-DD) — mesmo fuso em que o form grava lotes. */
export function spIsoDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);
}

function isoToUtcDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/** Início do período do frete: a terça mais recente (hoje, se hoje for terça). */
export function freightPeriodStart(now: Date = new Date()): string {
  return freightPeriodForDate(spIsoDate(now));
}

/** Início (terça-feira) do ciclo de frete que contém uma data civil ISO. */
export function freightPeriodForDate(iso: string): string {
  const date = isoToUtcDate(iso);
  const backToTuesday = (date.getUTCDay() - 2 + 7) % 7;
  return new Date(date.getTime() - backToTuesday * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Fim do período (exclusivo): início + 7 dias (a próxima terça). */
export function freightPeriodEnd(start: string): string {
  const date = isoToUtcDate(start);
  return new Date(date.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
}

/** Dia da semana (em São Paulo) de um timestamp para o card do dashboard. */
export function spWeekdayKey(isoTimestamp: string): FreightDayKey | null {
  const iso = spIsoDate(new Date(isoTimestamp));
  const dow = isoToUtcDate(iso).getUTCDay();
  const KEYS: (FreightDayKey | null)[] = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
  return KEYS[dow] ?? null;
}
