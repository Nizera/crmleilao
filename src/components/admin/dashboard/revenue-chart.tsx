"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatBRL } from "@/lib/lots";

export type RevenuePoint = { label: string; value: number };

const chartConfig = {
  value: { label: "Faturamento", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  return (
    <ChartContainer config={chartConfig} className="h-[240px] w-full">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(value: number) =>
            value.toLocaleString("pt-BR", {
              notation: "compact",
              maximumFractionDigits: 1,
            })
          }
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => (
                <span className="font-mono font-medium tabular-nums">
                  {formatBRL(Number(value))}
                </span>
              )}
            />
          }
        />
        <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
