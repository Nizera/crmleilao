"use client";

import { useState } from "react";
import { Bar,BarChart,CartesianGrid,XAxis,YAxis } from "recharts";
import { ChartContainer,ChartTooltip,ChartTooltipContent,type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { storeBRL,coinNumber } from "@/lib/store";
import type { StoreDashboardData } from "@/lib/store-dashboard";

const config={cash:{label:"Vendas em reais",color:"var(--chart-1)"},orders:{label:"Pedidos pagos",color:"var(--chart-2)"}} satisfies ChartConfig;
export function StoreDashboardChart({data}:{data:StoreDashboardData['chart']}) {
  const [metric,setMetric]=useState<'cash'|'orders'>('cash');
  return <div className="grid min-w-0 gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground">{metric==='cash' ? 'Reais em compras confirmadas' : 'Pedidos com pagamento confirmado'}</p><div className="flex gap-1" role="group" aria-label="Métrica do gráfico"><Button variant={metric==='cash'?'default':'outline'} size="sm" aria-pressed={metric==='cash'} onClick={()=>setMetric('cash')}>Reais</Button><Button variant={metric==='orders'?'default':'outline'} size="sm" aria-pressed={metric==='orders'} onClick={()=>setMetric('orders')}>Pedidos</Button></div></div>
    <ChartContainer config={config} className="aspect-auto h-[260px] w-full min-w-0" aria-label={metric==='cash'?'Vendas confirmadas em reais por dia':'Quantidade de pedidos pagos por dia'}>
      <BarChart accessibilityLayer data={data} margin={{top:8,right:8,left:0,bottom:0}}>
        <CartesianGrid vertical={false} strokeDasharray="3 3"/>
        <XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={28} tickFormatter={(s:string)=>s.slice(5).split('-').reverse().join('/')}/>
        <YAxis tickLine={false} axisLine={false} width={48} allowDecimals={metric==='cash'} tickFormatter={(v:number)=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(v)}/>
        <ChartTooltip content={<ChartTooltipContent labelFormatter={label=>String(label).split('-').reverse().join('/')} formatter={value=><span className="font-medium tabular-nums">{metric==='cash'?storeBRL(Number(value)):`${coinNumber(Number(value))} pedido(s)`}</span>}/>}/>
        <Bar key={metric} dataKey={metric} fill={`var(--color-${metric})`} radius={[4,4,0,0]} maxBarSize={36}/>
      </BarChart>
    </ChartContainer>
    {!data.some(row=>Number(row.orders)>0) && <p className="text-center text-sm text-muted-foreground">Nenhuma compra confirmada neste período.</p>}
  </div>;
}
