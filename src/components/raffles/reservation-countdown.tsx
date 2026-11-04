"use client";
import { useSyncExternalStore } from "react";
import { Clock3 } from "lucide-react";
const subscribe = (notify: () => void) => { const timer = setInterval(notify, 1000); return () => clearInterval(timer); };
const snapshot = () => Math.floor(Date.now() / 1000);
const serverSnapshot = () => 0;
export function ReservationCountdown({ deadline }: { deadline: string }) {
  const now = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const end = Date.parse(deadline);
  const seconds = now ? Math.max(0, Math.ceil(end / 1000) - now) : null;
  return <span className="inline-flex max-w-full items-center gap-1.5 text-xs font-semibold tabular-nums text-ouro-ink"><Clock3 size={13} className="shrink-0" />{!Number.isFinite(end) ? "Conferir prazo" : seconds === null ? "Conferindo prazo…" : seconds <= 0 ? "Conferindo cancelamento" : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")} para pagar`}</span>;
}
