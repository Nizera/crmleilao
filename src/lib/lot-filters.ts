import { isoDayAdd, isIsoDay, spDateTimeToUtc } from "@/lib/dates";

export const LOT_SHIFTS = {
  day: "Dia inteiro",
  morning: "Manhã · 06h às 12h",
  afternoon: "Tarde · 12h às 18h",
  night: "Noite · 18h às 06h do dia seguinte",
} as const;

export function lotShiftRange(day: string, shift: keyof typeof LOT_SHIFTS) {
  if (!isIsoDay(day)) throw new Error("Selecione um dia válido.");
  const next = isoDayAdd(day, 1);
  const ranges = {
    day: [day + "T00:00", next + "T00:00"],
    morning: [day + "T06:00", day + "T12:00"],
    afternoon: [day + "T12:00", day + "T18:00"],
    night: [day + "T18:00", next + "T06:00"],
  };
  return { from: ranges[shift][0], to: ranges[shift][1] };
}

export function parseLotRange(from = "", to = "") {
  if (!from && !to) return { from: "", to: "", startUtc: "", endUtc: "", error: "" };
  try {
    if (!from || !to) throw new Error("Preencha o início e o fim do período.");
    const startUtc = spDateTimeToUtc(from);
    const endUtc = spDateTimeToUtc(to);
    if (startUtc >= endUtc) throw new Error("O fim deve ser posterior ao início.");
    return { from, to, startUtc, endUtc, error: "" };
  } catch (error) {
    return { from: "", to: "", startUtc: "", endUtc: "", error: error instanceof Error ? error.message : "Período inválido." };
  }
}
