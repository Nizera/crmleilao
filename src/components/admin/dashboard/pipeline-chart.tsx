"use client";

import { Cell, Pie, PieChart } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { PIPELINE_COLORS } from "@/lib/chart-colors";

export type PipelineSlice = { status: string; label: string; count: number };

export function PipelineChart({ data }: { data: PipelineSlice[] }) {
  const config: ChartConfig = Object.fromEntries(
    data.map((slice) => [
      slice.status,
      {
        label: slice.label,
        color: PIPELINE_COLORS[slice.status] ?? "var(--chart-1)",
      },
    ]),
  );

  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        Nenhum lote lançado ainda.
      </div>
    );
  }

  return (
    <ChartContainer config={config} className="mx-auto aspect-square max-h-[200px]">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Pie
          data={data}
          dataKey="count"
          nameKey="status"
          innerRadius={52}
          outerRadius={82}
          paddingAngle={2}
          stroke="none"
        >
          {data.map((slice) => (
            <Cell
              key={slice.status}
              fill={PIPELINE_COLORS[slice.status] ?? "var(--chart-1)"}
            />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}
