"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveAuctionPeriod, type AuctionPeriod } from "@/lib/auction-period";

export function DashboardDatePicker({ period, today }: { period: AuctionPeriod; today: string }) {
  const router = useRouter();
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const apply = (event: FormEvent) => {
    event.preventDefault();
    try {
      const selected = resolveAuctionPeriod(undefined, { from, to });
      const params = new URLSearchParams();
      params.set("from", selected.from); params.set("to", selected.to);
      setError(null);
      startTransition(() => router.push("/admin/dashboard?" + params.toString()));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Confira o período."); }
  };
  return <form action="/admin/dashboard" method="get" onSubmit={apply} className="w-full rounded-xl border bg-card p-4">
    <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
      <label className="grid min-w-0 gap-1.5 text-sm font-medium">Início do leilão<Input name="from" type="datetime-local" step="60" required value={from} onChange={e => setFrom(e.target.value)} className="min-w-0 w-full" /></label>
      <label className="grid min-w-0 gap-1.5 text-sm font-medium">Fim do leilão<Input name="to" type="datetime-local" step="60" required value={to} onChange={e => setTo(e.target.value)} className="min-w-0 w-full" /></label>
      <div className="flex gap-2"><Button type="submit" disabled={pending}>{pending ? "Aplicando…" : "Aplicar período"}</Button><Button type="button" variant="outline" disabled={pending} onClick={() => {
        const current = resolveAuctionPeriod(today); setFrom(current.from); setTo(current.to); setError(null);
        startTransition(() => router.push("/admin/dashboard"));
      }}>Hoje</Button></div>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">Horário de São Paulo. O filtro usa o cadastro do lote. Lotes a partir do horário final ficam no próximo período.</p>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </form>;
}
