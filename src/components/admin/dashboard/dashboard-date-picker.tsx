"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Seletor de data do dashboard: navega para `/admin/dashboard?d=YYYY-MM-DD`.
 * O servidor recalcula todos os valores de dinheiro/histórico da data escolhida
 * (o dia é sempre o de São Paulo — ver `src/lib/dates.ts`).
 */
export function DashboardDatePicker({
  value,
  today,
}: {
  /** Data selecionada (YYYY-MM-DD, SP). */
  value: string;
  /** Hoje em SP — usado para mostrar o botão "Hoje" só quando não é o padrão. */
  today: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const goTo = (date: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (date === today) {
      params.delete("d");
    } else {
      params.set("d", date);
    }
    const query = params.toString();
    router.push(query ? `/admin/dashboard?${query}` : "/admin/dashboard");
  };

  return (
    <div className="flex items-center gap-2">
      {value !== today && (
        <Button size="sm" variant="ghost" onClick={() => goTo(today)}>
          Hoje
        </Button>
      )}
      <div className="relative">
        <CalendarIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="date"
          aria-label="Data do dashboard"
          value={value}
          max={today}
          onChange={(event) => {
            if (event.target.value) goTo(event.target.value);
          }}
          className="w-[10.5rem] pl-8"
        />
      </div>
    </div>
  );
}
