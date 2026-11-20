import { formatBRL } from "@/lib/lots";

export function LotPrice({ value, discount = 0, voucher = 0, stacked = false }: { value: number; discount?: number | null; voucher?:number|null; stacked?: boolean }) {
  const off = Number(discount ?? 0);
  if (stacked) {
    return <div className="ml-auto w-full min-w-0 max-w-[144px] space-y-1 text-right leading-tight">
      {off > 0 && <div className="text-xs font-normal text-muted-foreground"><del><span className="sr-only">Valor original: </span>{formatBRL((Math.round(Number(value)*100)+Math.round(off*100))/100)}</del></div>}
      <div className="font-semibold tabular-nums">{off > 0 && <span className="sr-only">Valor com desconto: </span>}{formatBRL(value)}</div>
      {Number(voucher) > 0 && <div className="ml-auto w-fit max-w-full rounded-md border border-yellow-500/60 bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-950"><div>Voucher aplicado</div><div className="tabular-nums">-{formatBRL(voucher)}</div></div>}
    </div>;
  }
  return <span className={stacked ? "inline-flex max-w-full flex-col items-end gap-1" : "inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5"}>{off > 0 && <del className="whitespace-nowrap text-xs font-normal text-muted-foreground"><span className="sr-only">Valor original: </span>{formatBRL((Math.round(Number(value)*100)+Math.round(off*100))/100)}</del>}<span className={stacked ? "whitespace-nowrap font-semibold leading-tight" : undefined}>{off > 0 && <span className="sr-only">Valor com desconto: </span>}{formatBRL(value)}</span>{Number(voucher)>0&&<span className="max-w-full whitespace-normal rounded border border-yellow-500/60 bg-yellow-100 px-2 py-0.5 text-xs font-semibold leading-tight text-yellow-950">Voucher -{formatBRL(voucher)}</span>}</span>;
}
