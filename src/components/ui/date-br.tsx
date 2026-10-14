"use client";

import { useSyncExternalStore, type ReactNode } from "react";

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

/** Forma estática — só manipulação de texto, idêntica no servidor e no cliente. */
function formatStatic(value: string, time: boolean): string {
  const day = value.length >= 10 ? formatDateBR(value.slice(0, 10)) : value;
  const hour = value.length >= 16 && value[10] === "T" ? value.slice(11, 16) : null;
  return time && hour ? `${day} ${hour}` : day;
}

/** Data/hora local — só é usada depois da hidratação. */
function formatLocal(value: string, time: boolean): string {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return formatStatic(value, time);
    return time
      ? date.toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : date.toLocaleDateString("pt-BR");
  } catch {
    return formatStatic(value, time);
  }
}

/**
 * Data (ou data+hora) em pt-BR sem causar hydration mismatch.
 *
 * No servidor e no primeiro render do cliente formatamos a string de forma
 * pura (sem `new Date`), o que é idêntico nos dois lados. Depois da
 * hidratação trocamos pela data/hora local — sem divergência inicial e sem o
 * React acusar "servidor != cliente".
 *
 * Sem isso, `new Date(x).toLocaleDateString("pt-BR")` avaliado na renderização
 * do servidor quebra para eventos entre 21h e 00h (o host roda em UTC e o
 * usuário em UTC-3).
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
