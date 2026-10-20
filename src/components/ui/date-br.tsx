"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import { SP_TIME_ZONE, spDayOf, spTimeOf } from "@/lib/dates";
import { formatDateBR } from "@/lib/lots";

/** Assinatura vazia: o "sistema externo" aqui é apenas a hidratação. */
const subscribe = () => () => {};

/** `true` no cliente depois da hidratação, `false` no servidor. */
const useMounted = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

/**
 * Forma estática — só manipulação de texto, idêntica no servidor e no cliente.
 * O dia vem do fuso da operação (SP), não do UTC do host.
 */
function formatStatic(value: string, time: boolean): string {
  const day = value.length >= 10 ? formatDateBR(spDayOf(value)) : value;
  const hasTime = value.length >= 16 && value[10] === "T";
  return time && hasTime ? `${day} ${spTimeOf(value)}` : day;
}

/** Data/hora no fuso da operação — só é usada depois da hidratação. */
function formatLocal(value: string, time: boolean): string {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return formatStatic(value, time);
    return time
      ? date.toLocaleString("pt-BR", {
          timeZone: SP_TIME_ZONE,
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : date.toLocaleDateString("pt-BR", { timeZone: SP_TIME_ZONE });
  } catch {
    return formatStatic(value, time);
  }
}

/**
 * Data (ou data+hora) em pt-BR sem causar hydration mismatch.
 *
 * No servidor e no primeiro render do cliente formatamos a string de forma
 * pura (sem `new Date`), o que é idêntico nos dois lados — e o dia/hora vêm
 * sempre de America/Sao_Paulo (`src/lib/dates.ts`), nunca do fuso do host.
 * Depois da hidratação trocamos pela data/hora formatada em SP: sem
 * divergência inicial e sem o React acusar "servidor != cliente".
 */
export function DateBR({
  value,
  time = false,
  fallback = null,
  className,
}: {
  value: string | null | undefined;
  /** Inclui HH:MM (usa o fuso local depois da hidratação). */
  time?: boolean;
  /** O que renderizar quando não há valor (ex.: "—"). */
  fallback?: ReactNode;
  className?: string;
}) {
  const mounted = useMounted();

  if (!value) return <>{fallback}</>;

  return (
    <span className={className}>
      {mounted ? formatLocal(value, time) : formatStatic(value, time)}
    </span>
  );
}
