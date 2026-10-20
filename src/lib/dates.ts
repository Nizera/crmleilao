/**
 * Dia civil da operação: tudo que o app chama de "hoje" é o dia de
 * America/Sao_Paulo — nunca o UTC do servidor da Vercel.
 *
 * Puro (sem "use server"/"use client"): funciona no servidor e no cliente.
 */

export const SP_TIME_ZONE = "America/Sao_Paulo";

const spDayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: SP_TIME_ZONE,
});

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Data civil em São Paulo (YYYY-MM-DD) de um instante. Padrão: agora.
 *
 * Strings que já são data pura (`YYYY-MM-DD`, coluna `date` do banco) voltam
 * intactas — converter tais strings via `Date` as faria cair no dia anterior
 * (2026-10-19 = meia-noite UTC = 21h do dia 18 em SP).
 */
export function spDayOf(value: Date | string | number = new Date()): string {
  if (typeof value === "string" && ISO_DAY.test(value)) return value;
  const instant =
    typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : value;
  return spDayFormat.format(instant);
}

/** Hoje em São Paulo (YYYY-MM-DD). */
export function spToday(): string {
  return spDayOf(new Date());
}

/** Mês civil em São Paulo (YYYY-MM) de um instante. Padrão: agora. */
export function spMonthOf(value: Date | string | number = new Date()): string {
  return spDayOf(value).slice(0, 7);
}

/** Soma dias em uma data civil (YYYY-MM-DD), sem depender de fuso. */
export function isoDayAdd(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** `true` quando a string é uma data civil válida (YYYY-MM-DD real). */
export function isIsoDay(value: string | null | undefined): value is string {
  if (!value || !ISO_DAY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** Deslocamento (ms) do fuso de São Paulo num instante. */
function spOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wallClock = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return wallClock - instant.getTime();
}

/**
 * Início do dia civil SP em UTC (ISO, inclusivo) — o corte `gte` para
 * consultas por dia. Meio-dia UTC como referência garante o offset do próprio dia.
 */
export function spDayStartUtc(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 12));
  return new Date(Date.UTC(y, m - 1, d) - spOffsetMs(guess)).toISOString();
}

/** Fim do dia civil SP em UTC (ISO, exclusivo) — o corte `lt`. */
export function spDayEndUtc(isoDay: string): string {
  return spDayStartUtc(isoDayAdd(isoDay, 1));
}

/** Início do mês civil SP em UTC (ISO, inclusivo) — corte `gte` por mês. */
export function spMonthStartUtc(isoMonth: string): string {
  return spDayStartUtc(`${isoMonth}-01`);
}

/** "19/10/2026" de uma data civil. */
export function formatIsoDayBR(isoDay: string): string {
  const [y, m, d] = isoDay.split("-");
  return `${d}/${m}/${y}`;
}

/** "sexta-feira, 19 de outubro" (pt-BR) de uma data civil. */
export function spDayLongLabel(isoDay: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SP_TIME_ZONE,
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(new Date(`${isoDay}T12:00:00Z`));
}

/** "outubro" (pt-BR) do mês civil de uma data. */
export function spMonthLabel(isoDay: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SP_TIME_ZONE,
    month: "long",
  }).format(new Date(`${isoDay}T12:00:00Z`));
}

/** "setembro" do mês anterior ao da data civil. */
export function spPrevMonthLabel(isoDay: string): string {
  const [y, m] = isoDay.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 15));
  return new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(prev);
}

/** "21:47" (pt-BR, 24h) de um timestamp, no fuso da operação. */
export function spTimeOf(value: string | Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(typeof value === "string" ? new Date(value) : value);
}
