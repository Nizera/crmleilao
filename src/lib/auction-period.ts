import { formatIsoDayBR, isoDayAdd, isIsoDay, spDateTimeToUtc, spToday } from "@/lib/dates";

export type AuctionPeriodInput = { from?: string; to?: string };
export type AuctionPeriod = {
  from: string;
  to: string;
  startUtc: string;
  endUtc: string;
  day: string;
  label: string;
};

export function resolveAuctionPeriod(day?: string, input: AuctionPeriodInput = {}): AuctionPeriod {
  if ((input.from === undefined) !== (input.to === undefined)) throw new Error("Informe o início e o fim do período.");
  const date = isIsoDay(day) ? day : spToday();
  const from = input.from ?? `${date}T00:00`;
  const to = input.to ?? `${isoDayAdd(date, 1)}T00:00`;
  const startUtc = spDateTimeToUtc(from);
  const endUtc = spDateTimeToUtc(to);
  const duration = Date.parse(endUtc) - Date.parse(startUtc);
  if (duration <= 0) throw new Error("O fim deve ser posterior ao início do leilão.");
  if (duration > 31 * 86_400_000) throw new Error("Escolha um período de até 31 dias.");
  const label = `${formatIsoDayBR(from.slice(0, 10))} às ${from.slice(11)} até ${formatIsoDayBR(to.slice(0, 10))} às ${to.slice(11)}`;
  return { from, to, startUtc, endUtc, day: from.slice(0, 10), label };
}

/** Início incluído, fim não incluído: períodos consecutivos não duplicam lotes. */
export function isInAuctionPeriod(timestamp: string, period: AuctionPeriod): boolean {
  const instant = Date.parse(timestamp);
  return instant >= Date.parse(period.startUtc) && instant < Date.parse(period.endUtc);
}
